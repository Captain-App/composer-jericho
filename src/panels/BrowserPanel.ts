import * as vscode from "vscode";
import { BrowserMonitor } from "../browser/monitor";
import { BrowserLog } from "../types";

export class BrowserPanel {
  private readonly _view: vscode.WebviewView;
  private readonly _browserMonitor: BrowserMonitor;

  private constructor(
    view: vscode.WebviewView,
    extensionUri: vscode.Uri,
    browserMonitor: BrowserMonitor
  ) {
    this._view = view;
    this._browserMonitor = browserMonitor;

    this._view.webview.options = {
      enableScripts: true,
      localResourceRoots: [extensionUri]
    };

    this._view.webview.html = this._getWebviewContent();
    this.setupEventListeners();
  }

  public static registerWebviewProvider(context: vscode.ExtensionContext): void {
    const provider = {
      resolveWebviewView: (webviewView: vscode.WebviewView) => {
        new BrowserPanel(
          webviewView,
          context.extensionUri,
          BrowserMonitor.getInstance()
        );
      }
    };

    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider("composer-web-browser", provider)
    );
  }

  private _getWebviewContent(): string {
    const isConnected = this._browserMonitor.isConnected();
    const pageInfo = this._browserMonitor.getActivePage();

    return `<!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { padding: 10px; }
            .status { margin-bottom: 15px; }
            .connected { color: #89D185; }
            .disconnected { color: #A1260D; }
            button { 
              width: 100%;
              padding: 8px;
              margin: 5px 0;
              background: var(--vscode-button-background);
              color: var(--vscode-button-foreground);
              border: none;
              border-radius: 2px;
              cursor: pointer;
            }
            button:hover {
              background: var(--vscode-button-hoverBackground);
            }
            .logs {
              margin-top: 15px;
              border: 1px solid var(--vscode-panel-border);
              padding: 10px;
              max-height: 300px;
              overflow-y: auto;
            }
          </style>
        </head>
        <body>
          <div class="status ${isConnected ? "connected" : "disconnected"}">
            Status: ${isConnected ? "🟢 Connected" : "🔴 Disconnected"}
            ${pageInfo ? `<br>Page: ${pageInfo.title}` : ""}
          </div>
          
          <button onclick="connect()">
            ${isConnected ? "Disconnect" : "Connect to Browser Tab"}
          </button>
          
          ${isConnected ? `
            <button onclick="capture()">Capture Tab State</button>
            <button onclick="clearLogs()">Clear Logs</button>
            <div class="logs" id="logs"></div>
          ` : ""}

          <script>
            const vscode = acquireVsCodeApi();
            
            function connect() {
              vscode.postMessage({ command: 'connect' });
            }
            
            function capture() {
              vscode.postMessage({ command: 'capture' });
            }
            
            function clearLogs() {
              vscode.postMessage({ command: 'clearLogs' });
              document.getElementById('logs').innerHTML = '';
            }

            window.addEventListener('message', event => {
              const message = event.data;
              switch (message.type) {
                case 'log':
                  const logsDiv = document.getElementById('logs');
                  const timestamp = new Date(message.log.timestamp).toLocaleTimeString();
                  logsDiv.innerHTML += \`<div>[\${timestamp}] [\${message.log.type}] \${message.log.text}</div>\`;
                  logsDiv.scrollTop = logsDiv.scrollHeight;
                  break;
                case 'refresh':
                  vscode.postMessage({ command: 'refresh' });
                  break;
              }
            });
          </script>
        </body>
      </html>`;
  }

  private setupEventListeners(): void {
    this._view.webview.onDidReceiveMessage(async message => {
      console.log("Panel received message:", message);
      switch (message.command) {
        case "connect":
          if (this._browserMonitor.isConnected()) {
            await this._browserMonitor.disconnect();
          } else {
            await this._browserMonitor.connect();
          }
          this._view.webview.html = this._getWebviewContent();
          break;
        
        case "capture":
          await vscode.commands.executeCommand("web-preview.smartCapture");
          break;
        
        case "clearLogs":
          await vscode.commands.executeCommand("web-preview.clearLogs");
          break;
        
        case "refresh":
          this._view.webview.html = this._getWebviewContent();
          break;
      }
    });

    // Update panel when browser connection state changes
    this._browserMonitor.onConnectionStateChange(() => {
      console.log("Connection state changed, updating panel");
      if (this._view.visible) {
        this._view.webview.html = this._getWebviewContent();
      }
    });

    // Update panel when new logs are received
    this._browserMonitor.onNewLog((log: BrowserLog) => {
      console.log("New log received in panel:", log);
      if (this._view.visible) {
        this._view.webview.postMessage({
          type: "log",
          log: log
        });
      }
    });
  }
} 