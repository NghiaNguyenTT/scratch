import { invoke } from "@tauri-apps/api/core";

// Font families installed on the OS, sorted alphabetically (case-insensitive).
export async function getSystemFonts(): Promise<string[]> {
  return invoke("get_system_fonts");
}
