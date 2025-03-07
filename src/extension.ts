import * as vscode from "vscode";
import { ComposerIntegration } from "./composer/integration";
import { BrowserMonitor } from "./browser/monitor";
import { CommandHandlers } from "./commands";
import { ToastService } from "./utils/toast";
import { BrowserPanel } from "./panels/BrowserPanel";
import { LoggingService } from "./utils/logging";

export function activate(context: vscode.ExtensionContext) {
  const logger = LoggingService.getInstance();
  const composerIntegration = ComposerIntegration.getInstance(context);
  const browserMonitor = BrowserMonitor.getInstance();
  const commandHandlers = new CommandHandlers(
    browserMonitor,
    composerIntegration
  );
  const toastService = ToastService.getInstance();

  logger.info("Activating web-preview extension");

  // Register the browser panel
  BrowserPanel.registerWebviewProvider(context);
  logger.debug("Registered browser panel webview provider");

  context.subscriptions.push(
    vscode.commands.registerCommand("web-preview.smartCapture", () => {
      logger.debug("Executing smart capture command");
      return commandHandlers.handleSmartCapture();
    }),
    vscode.commands.registerCommand("web-preview.clearLogs", () => {
      logger.debug("Executing clear logs command");
      return commandHandlers.handleClearLogs();
    }),
    vscode.commands.registerCommand("web-preview.sendLogs", () => {
      logger.debug("Executing send logs command");
      return commandHandlers.handleSendLogs();
    }),
    vscode.commands.registerCommand("web-preview.sendScreenshot", () => {
      logger.debug("Executing send screenshot command");
      return commandHandlers.handleSendScreenshot();
    }),
    browserMonitor
  );

  browserMonitor.onDisconnect(() => {
    logger.warn("Browser disconnected");
    toastService.showBrowserDisconnected();
  });

  logger.info("Web-preview extension activated successfully");
}

export function deactivate() {
  const logger = LoggingService.getInstance();
  logger.info("Deactivating web-preview extension");
}
