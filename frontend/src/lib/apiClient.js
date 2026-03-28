import axios from "axios";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
});

apiClient.interceptors.request.use((config) => {
  if (typeof config.url === "string" && config.url.startsWith("http://localhost:8000")) {
    config.url = config.url.replace("http://localhost:8000", API_BASE_URL);
  }
  return config;
});
