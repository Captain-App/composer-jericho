import * as vscode from "vscode";
import { BrowserMonitor } from "../browser/monitor";
import { ComposerIntegration } from "../composer/integration";

export class CommandHandlers {
  private browserMonitor: BrowserMonitor;
  private composerIntegration: ComposerIntegration;

  constructor(
    browserMonitor: BrowserMonitor,
    composerIntegration: ComposerIntegration
  ) {
    this.browserMonitor = browserMonitor;
    this.composerIntegration = composerIntegration;
  }

  public async handleSmartCapture(): Promise<void> {
    if (this.browserMonitor.isConnected()) {
      await this.handleCapture();
    } else {
      await this.browserMonitor.connect();
    }
  }

  public async handleClearLogs(): Promise<void> {
    if (!this.browserMonitor.isConnected()) {
      vscode.window.showErrorMessage(
        "No browser tab connected. Please connect to a tab first."
      );
      return;
    }

    const result = await vscode.window.showWarningMessage(
      "Are you sure you want to clear all logs?",
      { modal: true },
      "Yes",
      "No"
    );

    if (result === "Yes") {
      this.browserMonitor.clearLogs();
    }
  }

  public async handleSendLogs(): Promise<void> {
    if (!this.browserMonitor.isConnected()) {
      vscode.window.showErrorMessage(
        "No browser tab connected. Please connect to a tab first."
      );
      return;
    }

    await this.composerIntegration.sendLogs(this.browserMonitor.getLogs());
  }

  public async handleSendScreenshot(): Promise<void> {
    if (!this.browserMonitor.isConnected()) {
      vscode.window.showErrorMessage(
        "No browser tab connected. Please connect to a tab first."
      );
      return;
    }

    const page = await this.browserMonitor.getPageForScreenshot();
    if (!page) {
      vscode.window.showErrorMessage(
        "Failed to get page for screenshot. Please try reconnecting."
      );
      return;
    }

    await this.composerIntegration.sendScreenshot(page);
  }

  private async handleCapture(): Promise<void> {
    try {
      const page = await this.browserMonitor.getPageForScreenshot();
      if (!this.browserMonitor.isConnected()) {
        vscode.window.showErrorMessage(
          "No browser tab connected. Please connect to a tab first."
        );
        return;
      }

      if (!page) {
        vscode.window.showErrorMessage(
          "Failed to get page for capture. Please try reconnecting."
        );
        return;
      }

      await this.composerIntegration.sendCapture(
        page,
        this.browserMonitor.getLogs()
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to capture tab state: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}
