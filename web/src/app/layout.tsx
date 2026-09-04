import { ClerkProvider } from "@clerk/nextjs";
import { shadcn } from "@clerk/themes";
import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { themeBootScript } from "@/lib/theme";
import "./globals.css";
import { ConvexClientProvider } from "./providers";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "codex-kaboo", template: "%s · codex-kaboo" },
  description: "Codex usage dashboard for a shared account",
  applicationName: "codex-kaboo",
  // `manifest.ts`, `icon.svg` and `apple-icon.png` next to this file are picked up by Next's
  // metadata file conventions, so the manifest and icon links need no entries here.
  appleWebApp: { capable: true, title: "codex-kaboo", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f9fb" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1115" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // `suppressHydrationWarning`: the boot script below may add `class="dark"` and a
    // `color-scheme` style before React hydrates, so the server markup legitimately differs.
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript() }} />
      </head>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <ThemeProvider>
          {/* `shadcn` maps Clerk's widgets onto this app's CSS variables, so the sign-in card and
              the user menu follow the `dark` class with no per-theme Clerk config. */}
          <ClerkProvider
            signInUrl="/sign-in"
            signUpUrl="/sign-up"
            afterSignOutUrl="/sign-in"
            appearance={{ theme: shadcn }}
          >
            <ConvexClientProvider>
              <NuqsAdapter>{children}</NuqsAdapter>
            </ConvexClientProvider>
          </ClerkProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
