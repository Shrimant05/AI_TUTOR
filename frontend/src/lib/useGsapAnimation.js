// lib/useGsapAnimations.js
// ─────────────────────────────────────────────────────────
// Drop-in GSAP + Locomotive Scroll integration hook.
// Usage:
//   const { containerRef } = useGsapAnimations();
//   <div ref={containerRef} data-scroll-container> ... </div>
//
// Mark elements:
//   data-gsap="fade-up"   → slide up + fade
//   data-gsap="fade-in"   → pure fade
//   data-gsap="slide-in"  → slide from left
//   data-gsap="stagger"   → child elements stagger in
//   data-gsap-delay="0.2" → optional custom delay (seconds)
// ─────────────────────────────────────────────────────────
"use client";

import { useEffect, useRef, useCallback } from "react";

export function useGsapAnimations({ disableScroll = false } = {}) {
  const containerRef = useRef(null);
  const scrollRef    = useRef(null);
  const ctxRef       = useRef(null);

  const kill = useCallback(() => {
    ctxRef.current?.revert();
    scrollRef.current?.destroy();
    ctxRef.current = null;
    scrollRef.current = null;
  }, []);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      // Dynamic imports — works in Next.js (client-only)
      const [{ default: gsap }, { ScrollTrigger }] = await Promise.all([
        import("gsap"),
        import("gsap/ScrollTrigger"),
      ]);

      if (!mounted) return;
      gsap.registerPlugin(ScrollTrigger);

      // ── Locomotive Scroll ──
      if (!disableScroll && containerRef.current) {
        try {
          const LocomotiveScroll = (await import("locomotive-scroll")).default;
          scrollRef.current = new LocomotiveScroll({
            el: containerRef.current,
            smooth: true,
            multiplier: 0.85,
            lerp: 0.08,
            smartphone: { smooth: false },
            tablet: { smooth: false, breakpoint: 1024 },
          });

          // Bridge locomotive ↔ ScrollTrigger
          scrollRef.current.on("scroll", ScrollTrigger.update);
          ScrollTrigger.scrollerProxy(containerRef.current, {
            scrollTop(value) {
              if (arguments.length) {
                scrollRef.current.scrollTo(value, 0, 0);
              }
              return scrollRef.current.scroll.instance.scroll.y;
            },
            getBoundingClientRect() {
              return {
                top: 0, left: 0,
                width: window.innerWidth,
                height: window.innerHeight,
              };
            },
            pinType: containerRef.current.style.transform ? "transform" : "fixed",
          });

          ScrollTrigger.addEventListener("refresh", () => scrollRef.current.update());
          ScrollTrigger.refresh();
        } catch (e) {
          // Locomotive not installed — silently fall back to plain scroll
          console.warn("locomotive-scroll not found, using native scroll.", e);
        }
      }

      if (!mounted || !containerRef.current) return;

      // ── GSAP context for clean teardown ──
      ctxRef.current = gsap.context(() => {
        const scroller = scrollRef.current ? containerRef.current : undefined;

        // fade-up
        gsap.utils.toArray("[data-gsap='fade-up']").forEach((el) => {
          const delay = parseFloat(el.dataset.gsapDelay || "0");
          gsap.from(el, {
            y: 32,
            opacity: 0,
            duration: 0.75,
            delay,
            ease: "power3.out",
            scrollTrigger: {
              trigger: el,
              scroller,
              start: "top 88%",
              toggleActions: "play none none none",
            },
          });
        });

        // fade-in
        gsap.utils.toArray("[data-gsap='fade-in']").forEach((el) => {
          const delay = parseFloat(el.dataset.gsapDelay || "0");
          gsap.from(el, {
            opacity: 0,
            duration: 0.65,
            delay,
            ease: "power2.out",
            scrollTrigger: {
              trigger: el,
              scroller,
              start: "top 90%",
              toggleActions: "play none none none",
            },
          });
        });

        // slide-in (from left)
        gsap.utils.toArray("[data-gsap='slide-in']").forEach((el) => {
          const delay = parseFloat(el.dataset.gsapDelay || "0");
          gsap.from(el, {
            x: -40,
            opacity: 0,
            duration: 0.7,
            delay,
            ease: "power3.out",
            scrollTrigger: {
              trigger: el,
              scroller,
              start: "top 88%",
              toggleActions: "play none none none",
            },
          });
        });

        // stagger children
        gsap.utils.toArray("[data-gsap='stagger']").forEach((parent) => {
          const children = Array.from(parent.children);
          if (!children.length) return;
          const delay = parseFloat(parent.dataset.gsapDelay || "0");
          gsap.from(children, {
            y: 24,
            opacity: 0,
            duration: 0.6,
            delay,
            stagger: 0.08,
            ease: "power3.out",
            scrollTrigger: {
              trigger: parent,
              scroller,
              start: "top 88%",
              toggleActions: "play none none none",
            },
          });
        });
      }, containerRef.current);

      ScrollTrigger.refresh();
    };

    init();
    return () => {
      mounted = false;
      kill();
    };
  }, [disableScroll, kill]);

  return { containerRef, scrollInstance: scrollRef };
}

// ─────────────────────────────────────────────────────────
// Standalone helper: run a page-entry GSAP timeline on mount.
// Usage:
//   usePageEntry(pageRef);
// ─────────────────────────────────────────────────────────
export function usePageEntry(ref, opts = {}) {
  useEffect(() => {
    let ctx;
    const run = async () => {
      const { default: gsap } = await import("gsap");
      if (!ref.current) return;
      ctx = gsap.context(() => {
        const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
        tl.from(ref.current, {
          opacity: 0,
          duration: opts.duration || 0.5,
        });
      }, ref.current);
    };
    run();
    return () => ctx?.revert();
  }, [ref, opts.duration]);
}

// ─────────────────────────────────────────────────────────
// Standalone helper: staggered children entry on mount.
// Usage:
//   useStaggerEntry(wrapperRef, { selector: '.item' })
// ─────────────────────────────────────────────────────────
export function useStaggerEntry(ref, { selector = "*", y = 20, duration = 0.55, stagger = 0.07, delay = 0 } = {}) {
  useEffect(() => {
    let ctx;
    const run = async () => {
      const { default: gsap } = await import("gsap");
      if (!ref.current) return;
      ctx = gsap.context(() => {
        gsap.from(ref.current.querySelectorAll(selector), {
          y,
          opacity: 0,
          duration,
          delay,
          stagger,
          ease: "power3.out",
        });
      }, ref.current);
    };
    run();
    return () => ctx?.revert();
  }, [ref, selector, y, duration, stagger, delay]);
}