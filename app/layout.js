import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./globals.css";

export const metadata = {
  title: "Agentic Game Studio — Build interactive 3D worlds",
  description:
    "A focused workbench prototype for shaping and previewing interactive 3D game ideas.",
  applicationName: "Agentic Game Studio",
  openGraph: {
    title: "Agentic Game Studio",
    description: "A focused workbench for interactive 3D game ideas.",
    type: "website",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#09090b",
  viewportFit: "cover",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
