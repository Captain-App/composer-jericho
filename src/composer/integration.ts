import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import { LogData } from "../types";
import * as puppeteer from "puppeteer-core";
import {
  clearClipboard,
  copyImageToClipboard,
  copyTextToClipboard,
  delay,
} from "../utils/clipboard";
import { ToastService } from "../utils/toast";

export class ComposerIntegration {
  private static instance: ComposerIntegration;
  private readonly context: vscode.ExtensionContext;
  private composerOpened: boolean = false;
  private toastService: ToastService;

  private constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.toastService = ToastService.getInstance();
  }

  public static getInstance(
    context: vscode.ExtensionContext
  ): ComposerIntegration {
    if (!ComposerIntegration.instance) {
      ComposerIntegration.instance = new ComposerIntegration(context);
    }
    return ComposerIntegration.instance;
  }

  private async openComposer(): Promise<void> {
    if (this.composerOpened) {
      return;
    }
    try {
      await vscode.commands.executeCommand(
        "workbench.panel.composerViewPane2.resetViewContainerLocation"
      );
      this.composerOpened = true;
      await delay(100);
    } catch {
      this.toastService.showError(
        "Failed to open composer. Please make sure Cursor is installed and configured."
      );
      return;
    }
  }

  private async formatLogContent(logs: LogData): Promise<string> {
    const consoleMessages = logs.console
      .map((log) => `[${log.type}] ${log.text}`)
      .join("\n");

    const networkMessages = logs.network
      .map(
        (req) =>
          `${req.status} ${req.url}${req.error ? ` (Error: ${req.error})` : ""}`
      )
      .join("\n");

    return `Console Logs:\n${consoleMessages}\n\nNetwork Requests:\n${networkMessages}`;
  }

  private async sendToComposer(
    screenshot?: Buffer,
    logs?: LogData
  ): Promise<void> {
    try {
      await clearClipboard();

      if (screenshot) {
        const tmpFile = await this.saveScreenshotToTempFile(screenshot);
        try {
          await copyImageToClipboard(tmpFile);
          await delay(50);
          await vscode.commands.executeCommand("editor.action.clipboardPasteAction");
          await delay(50);
        } finally {
          await fs.unlink(tmpFile).catch(() => {});
        }
      }

      if (logs) {
        const content = await this.formatLogContent(logs);
        await copyTextToClipboard(content);
        await delay(50);
        await vscode.commands.executeCommand("editor.action.clipboardPasteAction");
      }
    } catch (error) {
      throw new Error(
        `Failed to send to composer: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async saveScreenshotToTempFile(screenshot: Buffer): Promise<string> {
    const manifest = require("../../package.json");
    const extensionId = `${manifest.publisher}.${manifest.name}`;
    const tmpDir = this.context.globalStorageUri.fsPath;
    const tmpFilePath = path.join(
      tmpDir,
      `${extensionId}-preview-${Date.now()}.png`
    );

    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(tmpFilePath, screenshot);
    return tmpFilePath;
  }

  public async sendLogs(logs: LogData): Promise<void> {
    await this.openComposer();
    await this.formatAndSendLogs(logs);
  }

  public async sendScreenshot(page: puppeteer.Page): Promise<void> {
    await this.openComposer();
    const screenshot = await this.captureScreenshot(page);
    await this.sendToComposer(screenshot, undefined);
  }

  public async sendCapture(page: puppeteer.Page, logs: LogData): Promise<void> {
    await this.openComposer();
    const screenshot = await this.captureScreenshot(page);
    await this.sendToComposer(screenshot, logs);
  }

  private async captureScreenshot(page: puppeteer.Page): Promise<Buffer> {
    const screenshot = await page.screenshot({
      type: "png",
      fullPage: true,
      encoding: "binary",
    });
    return Buffer.from(screenshot);
  }

  private async formatAndSendLogs(logs: LogData): Promise<void> {
    await this.sendToComposer(undefined, logs);
  }
}
