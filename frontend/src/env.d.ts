/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  /** Legacy alias; VITE_API_BASE_URL wins when both are set. */
  readonly VITE_API_BASE?: string;
  /** Full public endpoint, e.g. wss://api.example.com/api/multiplayer/ws. */
  readonly VITE_WS_URL?: string;
}
