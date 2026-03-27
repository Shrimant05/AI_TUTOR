import "./globals.css";
import AnimatedLayout from "../components/AnimatedLayout";

export const metadata = {
  title: "EDUXA | Empowering Students to Think, Not Just Retrieve",
  description: "A modern Socratic AI tutor that guides students to the answer without giving it away.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AnimatedLayout>{children}</AnimatedLayout>
      </body>
    </html>
  );
}