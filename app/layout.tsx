import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { APP_TITLE } from "@/lib/app-title";
import { DEFAULT_PREFS, THEMES } from "@/lib/themes";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: APP_TITLE,
  description: "A local web UI for the beads (bd) issue tracker",
};

// Applies the saved theme before first paint, so a dark or System choice doesn't
// flash light until React hydrates. Mirrors storageKey() and resolve() in
// components/theme-provider.tsx and parseThemePrefs() in lib/themes.ts; keep
// them in step.
const themeScript = `(function(){try{
var p=location.pathname.match(/^\\/p\\/([^/]+)/),s=localStorage,
raw=s.getItem(p?"bmus.theme."+decodeURIComponent(p[1]):"bmus.theme")??s.getItem("bmus-theme"),
modes=${JSON.stringify(Object.fromEntries(THEMES.map((t) => [t.id, t.mode])))},
def=${JSON.stringify(DEFAULT_PREFS)},pr={};
if(raw==="system")pr={mode:"system"};else if(raw&&raw[0]!=="{"){if(modes[raw]){pr={mode:modes[raw]};pr[modes[raw]]=raw}}else if(raw)pr=JSON.parse(raw);
var mode=pr.mode==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):pr.mode==="dark"?"dark":"light",
id=modes[pr[mode]]===mode?pr[mode]:def[mode];
var d=document.documentElement;d.dataset.theme=id;d.classList.toggle("dark",mode==="dark")
}catch(e){}})()`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
