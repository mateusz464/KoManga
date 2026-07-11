import { createServer, type Server } from "node:http";
import type { Express } from "express";
import supertest from "supertest";
import { afterEach, beforeEach } from "vitest";

const APP_HEADER = "x-komanga-test-app";

let server: Server | undefined;
let appsById = new Map<string, Express>();
let appIds = new WeakMap<Express, string>();
let nextAppId = 0;

export async function startTestServer(): Promise<void> {
  // A listener is ready before supertest receives it, so supertest does not
  // create and tear down a separate server for every request.
  server = createServer((req, res) => {
    const appId = req.headers[APP_HEADER];
    const app = typeof appId === "string" ? appsById.get(appId) : undefined;

    if (!app) {
      res.statusCode = 500;
      res.end("Missing test app");
      return;
    }

    delete req.headers[APP_HEADER];
    app(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    server?.once("error", reject);
    server?.listen(0, "127.0.0.1", () => {
      server?.off("error", reject);
      resolve();
    });
  });
}

export function request(app: Express) {
  if (!server) {
    throw new Error("HTTP test server is not running");
  }

  let appId = appIds.get(app);
  if (!appId) {
    appId = String(nextAppId++);
    appIds.set(app, appId);
    appsById.set(appId, app);
  }

  return supertest.agent(server).set(APP_HEADER, appId);
}

export async function closeTestServer(): Promise<void> {
  const currentServer = server;
  server = undefined;
  appsById = new Map<string, Express>();
  appIds = new WeakMap<Express, string>();
  nextAppId = 0;

  if (!currentServer) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    currentServer.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export type { Response } from "supertest";

beforeEach(async () => {
  await startTestServer();
});

afterEach(async () => {
  await closeTestServer();
});
