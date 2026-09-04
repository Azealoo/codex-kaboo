"use client";

import { Check, Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { THEME_PREFERENCES, themeLabel, type ThemePreference } from "@/lib/theme";
import { useTheme } from "./theme-provider";

const ICONS: Record<ThemePreference, typeof Sun> = { system: Monitor, light: Sun, dark: Moon };

export function ThemeToggle() {
  const { preference, resolved, setPreference } = useTheme();
  const Current = resolved === "dark" ? Moon : Sun;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Theme: ${themeLabel(preference)}. Change theme`}
          title="Theme"
        >
          <Current className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        {THEME_PREFERENCES.map((p) => {
          const Icon = ICONS[p];
          const selected = p === preference;
          return (
            <DropdownMenuItem
              key={p}
              role="menuitemradio"
              aria-checked={selected}
              onSelect={() => setPreference(p)}
            >
              <Icon aria-hidden="true" />
              {themeLabel(p)}
              {selected ? <Check className="ml-auto" aria-hidden="true" /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
