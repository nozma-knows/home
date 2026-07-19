import type { AppType } from "@home/api";
import { hc } from "hono/client";

import { apiUrl } from "./config";

export const apiClient = hc<AppType>(apiUrl, {
  init: {
    credentials: "include",
  },
});
