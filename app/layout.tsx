import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { APP_TITLE } from "@/lib/app-title";
import { DEFAULT_THEME_ID, THEMES } from "@/lib/themes";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: APP_TITLE,
  description: "A local web UI for the beads (bd) issue tracker",
};

// Applies the saved theme before first paint, so a dark or System choice doesn't
// flash light until React hydrates. Mirrors storageKey() and resolve() in
// components/theme-provider.tsx; keep them in step.
const themeScript = `(function(){try{
var p=location.pathname.match(/^\\/p\\/([^/]+)/),s=localStorage,
id=s.getItem(p?"bmus.theme."+decodeURIComponent(p[1]):"bmus.theme")??s.getItem("bmus-theme"),
modes=${JSON.stringify(Object.fromEntries(THEMES.map((t) => [t.id, t.mode])))},mode=modes[id];
if(!mode){id="${DEFAULT_THEME_ID}";mode=modes[id]}
if(mode==="system"){id=mode=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}
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
