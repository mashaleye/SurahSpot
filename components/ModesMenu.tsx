"use client";

import { createPortal } from "react-dom";
import { useEffect, useId, useRef, useState } from "react";
import { GAME_MODES, type GameMode, type ModeId } from "@/lib/game/modes";

export const LEARNING_BLOCKS_MODE_ID = "learning-blocks" as const;
export type ModeMenuId = ModeId | typeof LEARNING_BLOCKS_MODE_ID;

const LEARNING_BLOCKS_MODE = {
  id: LEARNING_BLOCKS_MODE_ID,
  name: "Learning Blocks",
  tagline: "Read page by page, hide Ayahs, and practice recall at your own pace.",
} as const;

type MenuMode = GameMode | typeof LEARNING_BLOCKS_MODE;
const MENU_MODES: readonly MenuMode[] = [...GAME_MODES, LEARNING_BLOCKS_MODE];

/**
 * Mode picker for the shared navigation pill.
 *
 * Scored game modes stay inside the game attempt system. Learning Blocks is an
 * unscored reader, so selecting it navigates to its dedicated route instead of
 * creating a round. The menu is still shared so it feels like one SurahSpot
 * practice system to the user.
 */
export type ModesMenuProps = {
  activeModeId: ModeMenuId;
  activeVariantId?: string;
  onSelect: (modeId: ModeId, variantId?: string) => void;
  disabled?: boolean;
};

type MenuPosition = { top: number; left: number };

function isGameMode(mode: MenuMode): mode is GameMode {
  return mode.id !== LEARNING_BLOCKS_MODE_ID;
}

export function ModesMenu({ activeModeId, activeVariantId, onSelect, disabled = false }: ModesMenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  const activeMode = MENU_MODES.find((mode) => mode.id === activeModeId) ?? MENU_MODES[0];

  const updatePosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const halfMenu = Math.min(170, Math.max(140, (window.innerWidth - 24) / 2));
    const left = Math.min(
      window.innerWidth - 12 - halfMenu,
      Math.max(12 + halfMenu, rect.left + rect.width / 2),
    );
    setPosition({ top: rect.bottom + 10, left });
  };

  useEffect(() => {
    if (!open) return;
    updatePosition();

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (containerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    const onViewportChange = () => updatePosition();

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [open]);

  const choose = (mode: MenuMode, variantId?: string) => {
    setOpen(false);
    triggerRef.current?.focus();

    if (!isGameMode(mode)) {
      window.location.assign("/learning-blocks");
      return;
    }
    onSelect(mode.id, variantId ?? mode.defaultVariant);
  };

  const menu = open && position && typeof document !== "undefined" ? createPortal(
    <div
      ref={menuRef}
      className="modes-dropdown modes-dropdown-portal"
      id={menuId}
      role="menu"
      aria-label="Practice modes"
      style={{ top: position.top, left: position.left }}
    >
      {MENU_MODES.map((mode) => {
        const isActive = mode.id === activeModeId;
        const gameMode = isGameMode(mode) ? mode : null;
        return (
          <div className="modes-group" key={mode.id}>
            <button
              type="button"
              role="menuitemradio"
              aria-checked={isActive}
              className={isActive ? "modes-item is-active" : "modes-item"}
              onClick={() => choose(mode)}
              disabled={disabled}
            >
              <span className="modes-item-copy">
                <b>{mode.name}</b>
                <small>{mode.tagline}</small>
              </span>
              {isActive && <span className="modes-tick" aria-hidden="true">&#10003;</span>}
            </button>

            {gameMode?.variants?.length ? (
              <div className="modes-variants" role="group" aria-label={`${gameMode.name} play styles`}>
                {gameMode.variants.map((variant) => {
                  const variantActive = isActive && (activeVariantId ?? gameMode.defaultVariant) === variant.id;
                  return (
                    <button
                      type="button"
                      key={variant.id}
                      role="menuitemradio"
                      aria-checked={variantActive}
                      className={variantActive ? "modes-variant is-active" : "modes-variant"}
                      onClick={() => choose(gameMode, variant.id)}
                      disabled={disabled}
                    >
                      <b>{variant.name}</b>
                      <small>{variant.tagline}</small>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}

      <p className="modes-note">
        {activeMode.id === LEARNING_BLOCKS_MODE_ID
          ? "Learning Blocks is unscored. Choose a game mode whenever you want to return to a seven-round attempt."
          : "Switching game modes starts a new attempt. Learning Blocks opens an unscored study reader."}
      </p>
    </div>,
    document.body,
  ) : null;

  return (
    <div className="modes-menu" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className={open ? "nav-pill modes-trigger active is-open" : "nav-pill modes-trigger"}
        onClick={() => {
          if (!open) updatePosition();
          setOpen((value) => !value);
        }}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
      >
        Modes
        <svg className="modes-chevron" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path
            d="M4 6l4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {menu}
    </div>
  );
}
