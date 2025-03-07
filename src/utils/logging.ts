
import fetch from "node-fetch";

export type LogLevel = "info" | "warn" | "error" | "debug" | "trace";

interface LogPayload {
  level: LogLevel;
  message: string;
  error?: Error;
  timestamp: string;
  source: string;
}

export class LoggingService {
  private static instance: LoggingService;
  private debugServerUrl: string;

  private constructor() {
    const debugPort = process.env.DEBUG_PORT || 7777;
    this.debugServerUrl = `http://localhost:${debugPort}`;
  }

  public static getInstance(): LoggingService {
    if (!LoggingService.instance) {
      LoggingService.instance = new LoggingService();
    }
    return LoggingService.instance;
  }

  private async sendToServer(payload: LogPayload): Promise<void> {
    try {
      const response = await fetch(this.debugServerUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.error(`Failed to send log to debug server: ${response.statusText}`);
      }
    } catch (error) {
      console.error("Error sending log to debug server:", error);
    }
  }

  private log(level: LogLevel, message: string, error?: Error) {
    const payload: LogPayload = {
      level,
      message,
      error,
      timestamp: new Date().toISOString(),
      source: "extension"
    };

    // Send to debug server
    this.sendToServer(payload);

    // Also log to VS Code's output channel
    switch (level) {
      case "error":
        console.error(message, error);
        break;
      case "warn":
        console.warn(message);
        break;
      default:
        console.log(message);
    }
  }

  public info(message: string) {
    this.log("info", message);
  }

  public warn(message: string) {
    this.log("warn", message);
  }

  public error(message: string, error?: Error) {
    this.log("error", message, error);
  }

  public debug(message: string) {
    this.log("debug", message);
  }

  public trace(message: string) {
    this.log("trace", message);
  }
} 