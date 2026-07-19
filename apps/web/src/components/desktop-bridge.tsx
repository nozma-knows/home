"use client";

import { useEffect } from "react";

import { apiClient } from "@/lib/api-client";

export function DesktopBridge() {
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    void Promise.all([
      apiClient.v1.sidecars.token.$post({
        json: { deviceName: navigator.platform || "home desktop" },
      }),
      import("@tauri-apps/api/core"),
    ]).then(async ([response, { invoke }]) => {
      if (!response.ok) return;
      const credentials = await response.json();
      await invoke("start_sidecar", {
        token: credentials.token,
        socketUrl: credentials.socketUrl,
      });
    });
  }, []);
  return null;
}
