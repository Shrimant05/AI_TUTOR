"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import RoleSidebarNav from "./RoleSidebarNav";

export default function AnimatedLayout({ children }) {
  const pathname = usePathname();
  const showSidebar = pathname !== "/" && pathname !== "/student";
  const sidebarRef = useRef(null);
  const mainRef = useRef(null);

  useEffect(() => {
    let ctx;
    const run = async () => {
      const { default: gsap } = await import("gsap");
      ctx = gsap.context(() => {
        const tl = gsap.timeline({ defaults: { ease: "power3.out" } });

        if (showSidebar && sidebarRef.current) {
          tl.from(sidebarRef.current, {
            x: -60,
            opacity: 0,
            duration: 0.7,
          }).from(
            mainRef.current,
            {
              opacity: 0,
              y: 18,
              duration: 0.55,
            },
            "-=0.35"
          );
        } else {
          tl.from(mainRef.current, {
            opacity: 0,
            y: 18,
            duration: 0.55,
          });
        }
      });
    };
    run();
    return () => ctx?.revert();
  }, [showSidebar]);

  return (
    <div className="app-container">
      {showSidebar ? (
        <aside ref={sidebarRef} className="sidebar glass-panel">
          <RoleSidebarNav />
        </aside>
      ) : null}

      <main ref={mainRef} className="main-content">
        {children}
      </main>
    </div>
  );
}