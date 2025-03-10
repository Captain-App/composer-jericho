import * as vscode from "vscode";
import * as puppeteer from "puppeteer-core";
import { EventEmitter } from "events";
import { BrowserLog, MonitoredPage, NetworkRequest, LogData } from "../types";
import { ConfigManager } from "../config";
import { ToastService } from "../utils/toast";

export class BrowserMonitor extends EventEmitter {
  private static instance: BrowserMonitor;
  private browser: puppeteer.Browser | null = null;
  private activePage: {
    page: puppeteer.Page;
    client: puppeteer.CDPSession;
    info: MonitoredPage;
  } | null = null;
  private consoleLogs: BrowserLog[] = [];
  private networkLogs: NetworkRequest[] = [];
  private statusBarItem: vscode.StatusBarItem;
  private _isConnected: boolean = false;
  private configManager: ConfigManager;
  private disconnectEmitter = new vscode.EventEmitter<void>();
  private connectionStateEmitter = new vscode.EventEmitter<void>();
  private newLogEmitter = new vscode.EventEmitter<BrowserLog>();
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private toastService: ToastService;

  private constructor() {
    super();
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.command = "web-preview.smartCapture";
    this.configManager = ConfigManager.getInstance();
    this.toastService = ToastService.getInstance();
    this.updateConnectionState();
  }

  public static getInstance(): BrowserMonitor {
    if (!BrowserMonitor.instance) {
      BrowserMonitor.instance = new BrowserMonitor();
    }
    return BrowserMonitor.instance;
  }

  private updateStatusBar() {
    if (!this._isConnected) {
      this.statusBarItem.text = "$(plug) Connect Browser Tab";
    } else {
      this.statusBarItem.text = `$(eye) Capture Tab Info (${this.activePage?.info.title})`;
    }
    this.statusBarItem.tooltip = this._isConnected
      ? `Connected to: ${this.activePage?.info.url}`
      : "Click to connect to a browser tab";
    this.statusBarItem.show();
  }

  private updateConnectionState() {
    console.log("Updating connection state:", { isConnected: this._isConnected, hasActivePage: this.activePage !== null });
    this._isConnected = this.activePage !== null;
    vscode.commands.executeCommand("setContext", "web-preview:browserConnected", this._isConnected);
    this.connectionStateEmitter.fire();
    this.updateStatusBar();
  }

  public async connect(): Promise<void> {
    console.log("Attempting to connect to browser...");
    const debugUrl = this.configManager.get<string>("remoteDebuggingUrl");

    try {
      const puppeteer = await import("puppeteer-core");
      this.browser = await puppeteer.connect({
        browserURL: debugUrl,
        defaultViewport: null,
      });
      console.log("Connected to browser, getting pages...");

      const pages = await this.browser.pages();
      console.log("Found pages:", pages.length);
      if (!pages?.length) {
        throw new Error(
          "No open pages found. Please open at least one tab in Chrome."
        );
      }

      const picks = await Promise.all(
        pages.map(async (page) => {
          let title = "";
          let url = "";
          try {
            title = await page.title();
            url = await page.url();
          } catch {
            // Ignore errors and use empty strings
          }
          return {
            label: title || url || "Untitled Page",
            description: url,
            page,
            info: { title, url, id: url },
          };
        })
      );
      console.log("Page options:", picks.map(p => ({ label: p.label, url: p.description })));

      const selection = await vscode.window.showQuickPick(picks, {
        placeHolder: "Select the webpage to monitor",
        matchOnDescription: true,
      });

      if (!selection) {
        console.log("No page selected, aborting connection");
        return;
      }

      console.log("Selected page:", selection.info);
      await this.monitorPage(selection.page, selection.info);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("Connection error:", errorMessage);
      this.toastService.showError(`Failed to connect: ${errorMessage}`);
      this.disconnect();
    }
  }

  private async monitorPage(page: puppeteer.Page, pageInfo: MonitoredPage) {
    if (this.activePage) {
      await this.stopMonitoring();
    }

    const client = await page.createCDPSession();

    try {
      await Promise.all([
        client.send("Page.enable"),
        client.send("Network.enable"),
        client.send("Runtime.enable"),
        client.send("Log.enable"),
      ]);
    } catch (error) {
      this.toastService.showError("Failed to initialize browser session");
      await this.disconnect();
      return;
    }

    this.activePage = { page, client, info: pageInfo };
    this.updateConnectionState();

    // Set up console log capture
    await page.evaluate(() => {
      const originalConsole = {
        log: console.log.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console),
        info: console.info.bind(console),
        debug: console.debug.bind(console),
      };

      type ConsoleMethod = keyof typeof originalConsole;

      (Object.keys(originalConsole) as ConsoleMethod[]).forEach((method) => {
        console[method] = function (...args: unknown[]) {
          originalConsole[method](...args);
        };
      });
    });

    this.setupEventListeners(client);
    this.updateStatusBar();

    await this.showSuccessNotification();
  }

  private setupEventListeners(client: puppeteer.CDPSession) {
    this.healthCheckInterval = setInterval(async () => {
      try {
        await client.send("Runtime.evaluate", { expression: "1" });
      } catch (error) {
        this.clearHealthCheck();
        await this.handleSessionError();
      }
    }, 5 * 60 * 1000);

    client.on("Runtime.consoleAPICalled", (e) => {
      console.log("Console API called:", { type: e.type, args: e.args });
      const formattedArgs = e.args.map((arg) => {
        if (arg.type === "object" && arg.preview) {
          if (arg.preview.subtype === "array") {
            const items = arg.preview.properties
              .map((p, index) => `${index}: ${p.value}`)
              .join(",\n    ");
            return `Array(${arg.preview.properties.length}) [\n    ${items}\n]`;
          }
          if (arg.preview.properties) {
            const props = arg.preview.properties
              .map(
                (p) =>
                  `${p.name}: ${
                    typeof p.value === "string"
                      ? `"${p.value}"`
                      : p.value || "undefined"
                  }`
              )
              .join(", ");
            return `Object {${props}}`;
          }
          return arg.preview.description || "Object {}";
        } else if (arg.type === "function") {
          return arg.description || "function";
        } else if (arg.type === "undefined") {
          return "undefined";
        } else if (arg.type === "string") {
          return arg.value;
        } else if (arg.type === "number" || arg.type === "boolean") {
          return String(arg.value);
        } else if (arg.type === "symbol") {
          return arg.description || "Symbol()";
        } else if ("subtype" in arg && arg.subtype === "error") {
          if (arg.description && arg.description.includes("\n")) {
            return arg.description;
          }
          const stack =
            arg.preview?.properties?.find((p) => p.name === "stack")?.value ||
            "";
          const message =
            arg.preview?.properties?.find((p) => p.name === "message")?.value ||
            "";
          if (stack && message) {
            return `Error: ${message}\n${stack}`;
          }
          return `${arg.description || arg.value || "Error"}`;
        } else {
          return arg.value || arg.description || "";
        }
      });

      const logType = e.type === "warning" ? "warn" : 
                     (e.type === "debug" || e.type === "log" || e.type === "info" || e.type === "error") ? e.type : "log";

      const log: BrowserLog = {
        type: logType,
        text: formattedArgs.join(" "),
        timestamp: Date.now(),
      };
      
      console.log("Emitting console log:", log);
      this.consoleLogs.push(log);
      this.newLogEmitter.fire(log);
    });

    client.on("Log.entryAdded", (e) => {
      console.log("Log entry added:", e.entry);
      const logType = e.entry.level === "warning" ? "warn" :
                     (e.entry.level === "error" || e.entry.level === "info") ? e.entry.level : "log";
                     
      const log: BrowserLog = {
        type: logType,
        text: e.entry.text,
        timestamp: Date.now(),
      };
      
      console.log("Emitting log entry:", log);
      this.consoleLogs.push(log);
      this.newLogEmitter.fire(log);
    });

    client.on("Network.responseReceived", (e) => {
      const request: NetworkRequest = {
        url: e.response.url,
        status: e.response.status,
        timestamp: Date.now(),
      };
      this.networkLogs.push(request);
      this.emit("network", request);
    });

    client.on("Network.loadingFailed", (e) => {
      const request: NetworkRequest = {
        url: "Failed request",
        status: 0,
        error: e.errorText,
        timestamp: Date.now(),
      };
      this.networkLogs.push(request);
      this.emit("network", request);
    });

    // Listen for page close/crash events
    this.activePage?.page.on("close", () => this.handlePageClosed());
    this.activePage?.page.on("crash", () => this.handlePageClosed());
  }

  private async showSuccessNotification() {
    await this.toastService.showProgress(
      "Successfully connected to tab",
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    );
  }

  private async handleSessionError() {
    if (this._isConnected) {
      this.toastService.showSessionDisconnected();
      await this.disconnect();
    }
  }

  private async handlePageClosed() {
    if (this._isConnected) {
      this.toastService.showTabClosed();
      await this.disconnect();
    }
  }

  public clearLogs(): void {
    this.consoleLogs = [];
    this.networkLogs = [];
  }

  public onDisconnect(listener: () => void): vscode.Disposable {
    return this.disconnectEmitter.event(listener);
  }

  public async disconnect() {
    this.clearHealthCheck();
    await this.stopMonitoring();
    if (this.browser) {
      await this.browser.disconnect().catch(() => {});
      this.browser = null;
    }
    this.updateConnectionState();
    this.disconnectEmitter.fire();
  }

  private async stopMonitoring() {
    if (this.activePage) {
      try {
        await this.activePage.client.detach();
      } catch {}
      this.activePage = null;
    }
  }

  public getActivePage(): MonitoredPage | null {
    return this.activePage?.info || null;
  }

  public getLogs(): LogData {
    return {
      console: this.consoleLogs,
      network: this.networkLogs,
    };
  }

  public isConnected(): boolean {
    return this._isConnected;
  }

  public dispose() {
    this.disconnect();
    this.statusBarItem.dispose();
  }

  public async getPageForScreenshot(): Promise<puppeteer.Page | null> {
    if (!this.activePage?.page) {
      return null;
    }

    try {
      // Verify the page is still responsive
      await this.activePage.page.evaluate(() => true);
      return this.activePage.page;
    } catch (error) {
      await this.handleSessionError();
      return null;
    }
  }

  private clearHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  public onConnectionStateChange(listener: () => void): vscode.Disposable {
    return this.connectionStateEmitter.event(listener);
  }

  public onNewLog(listener: (log: BrowserLog) => void): vscode.Disposable {
    return this.newLogEmitter.event(listener);
  }
}
