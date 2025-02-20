import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import { LogData } from "../types";
import {
  clearClipboard,
  verifyClipboardContent,
  copyImageToClipboard,
  copyTextToClipboard,
  delay,
} from "../utils/clipboard";

export class ComposerIntegration {
  private static instance: ComposerIntegration;
  private readonly context: vscode.ExtensionContext;
  private composerOpened: boolean = false;

  private constructor(context: vscode.ExtensionContext) {
    this.context = context;
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
      vscode.window.showErrorMessage(
        "Failed to open composer. Please make sure Cursor is installed and configured."
      );
      return;
    }
  }

  public async sendToComposer(
    screenshot?: Buffer,
    logs?: LogData
  ): Promise<void> {
    const maxRetries = 2;
    let imageAttempt = 0;
    let textAttempt = 0;
    let imageSuccess = false;
    let textSuccess = false;

    const formattedLogs = logs ? this.formatLogs(logs) : "";

    while (
      (screenshot && !imageSuccess && imageAttempt <= maxRetries) ||
      (formattedLogs && !textSuccess && textAttempt <= maxRetries)
    ) {
      try {
        await this.openComposer();

        if (screenshot && !imageSuccess) {
          await clearClipboard();
          try {
            await this.sendImageToComposer(screenshot);
            await verifyClipboardContent("image");
            imageSuccess = true;
          } catch (err) {
            if (imageAttempt === maxRetries) {
              throw new Error(`Failed to send image: ${String(err)}`);
            }
            imageAttempt++;
            await delay(100);
          }
        }

        if (formattedLogs && !textSuccess) {
          await delay(50);
          await clearClipboard();
          try {
            await this.prepareTextForComposer(formattedLogs);
            await verifyClipboardContent("text");
            textSuccess = true;
          } catch (err) {
            if (textAttempt === maxRetries) {
              throw new Error(`Failed to send logs: ${String(err)}`);
            }
            textAttempt++;
            await delay(100);
          }
        }

        if ((!screenshot || imageSuccess) && (!formattedLogs || textSuccess)) {
          await this.showSuccessNotification();
          return;
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(
          `Failed to send data to composer: ${errorMessage}`
        );
        throw error;
      } finally {
        this.composerOpened = false;
      }
    }
  }

  private async sendImageToComposer(screenshot: Buffer): Promise<void> {
    const manifest = require("../../package.json");
    const extensionId = `${manifest.publisher}.${manifest.name}`;
    const tmpDir = this.context.globalStorageUri.fsPath;
    let tmpFile: string | undefined;

    try {
      const tmpFilePath = path.join(
        tmpDir,
        `${extensionId}-preview-${Date.now()}.png`
      );

      await Promise.all([
        fs.mkdir(tmpDir, { recursive: true }),
        fs.writeFile(tmpFilePath, screenshot),
      ]);
      tmpFile = tmpFilePath;

      await copyImageToClipboard(tmpFile);
      await delay(50);
      await vscode.commands.executeCommand(
        "editor.action.clipboardPasteAction"
      );
      await delay(50);
    } catch (error) {
      throw new Error(`Failed to send image: ${error}`);
    } finally {
      if (tmpFile) {
        fs.unlink(tmpFile).catch((error) =>
          console.error("Failed to clean up temporary file:", error)
        );
      }
    }
  }

  private async prepareTextForComposer(text: string): Promise<void> {
    if (!text) {
      return;
    }

    await copyTextToClipboard(text);
    await delay(50);
    await vscode.commands.executeCommand("editor.action.clipboardPasteAction");
    await delay(50);
  }

  private async showSuccessNotification() {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Successfully sent to Composer",
        cancellable: false,
      },
      async (progress) => {
        await delay(2000);
        progress.report({ increment: 500 });
      }
    );
  }

  private formatLogs(logs: LogData): string {
    let result = "---Console Logs---\n";
    logs.console.forEach((log) => {
      const formattedLog = {
        type: log.type,
        message: log.text,
      };
      result += `${formattedLog.type}: ${formattedLog.message}\n`;
    });

    result += "\n---Network Requests---\n";
    logs.network.forEach((log) => {
      const formattedLog = {
        url: log.url,
        status: log.status,
        ...(log.error && { error: log.error }),
      };
      if (formattedLog.error) {
        result += `Failed: ${formattedLog.url} (${formattedLog.error})\n`;
      } else {
        result += `${formattedLog.status}: ${formattedLog.url}\n`;
      }
    });
    return result;
  }
}
