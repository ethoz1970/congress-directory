"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/AuthContext";
import LoginModal from "./LoginModal";
import UserProfileContent from "./UserProfileContent";

// List of admin email addresses (lowercase)
const ADMIN_EMAILS = [
  "marioguzman1970@gmail.com",
  "blackskymedia@gmail.com",
  // Add more admin emails here
];

function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase().trim());
}

interface UserMenuProps {
  showFavoritesOnly?: boolean;
  setShowFavoritesOnly?: (value: boolean) => void;
  favoritesCount?: number;
}

export default function UserMenu({ showFavoritesOnly, setShowFavoritesOnly, favoritesCount = 0 }: UserMenuProps) {
  const { user, loading, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();

  const isAdmin = isAdminEmail(user?.email);

  useEffect(() => {
    setMounted(true);

    // Lock body scroll when slide-over is open
    if (menuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }

    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [menuOpen]);

  if (loading) {
    return (
      <div className="w-8 h-8 rounded-full bg-gray-200 animate-pulse" />
    );
  }

  if (!user) {
    return (
      <>
        <button
          onClick={() => setShowLoginModal(true)}
          className="flex items-center justify-center px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-semibold shadow-sm"
        >
          Sign In
        </button>

        <LoginModal
          isOpen={showLoginModal}
          onClose={() => setShowLoginModal(false)}
        />
      </>
    );
  }

  return (
    <>
      <div className="relative">
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="flex items-center gap-2 focus:outline-none relative"
        >
          {user.photoURL ? (
            <img
              src={user.photoURL}
              alt={user.displayName || "User"}
              className={`w-8 h-8 rounded-full border-2 transition-colors ${showFavoritesOnly ? "border-red-400" : "border-gray-200 hover:border-blue-400"
                }`}
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white font-medium">
              {user.displayName?.charAt(0) || user.email?.charAt(0) || "U"}
            </div>
          )}
          {/* Favorites indicator badge */}
          {showFavoritesOnly && (
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white" />
          )}
        </button>
      </div>

      {mounted && createPortal(
        <div
          className={`fixed inset-0 z-[102] flex justify-end transition-opacity duration-300 ${menuOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
            }`}
        >
          {/* Backdrop */}
          <div
            className={`absolute inset-0 bg-black/60 transition-opacity duration-300 ${menuOpen ? "opacity-100" : "opacity-0"
              }`}
            onClick={() => setMenuOpen(false)}
          />

          {/* Slide-over Panel */}
          <div
            className={`relative h-full w-[95%] sm:max-w-2xl bg-white shadow-2xl flex flex-col transition-transform duration-300 ease-in-out overflow-hidden rounded-l-2xl sm:rounded-none ${menuOpen ? "translate-x-0" : "translate-x-full"
              }`}
          >
            {/* Top action button - fixed position within panel */}
            <div className="absolute top-4 left-4 flex items-center gap-2 z-[100]">
              <button
                onClick={() => setMenuOpen(false)}
                className="w-10 h-10 flex items-center justify-center bg-white text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-full shadow-md border border-gray-200 transition-colors"
                aria-label="Close menu"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden w-full pt-16 bg-gray-50/50">
              <UserProfileContent onCloseMenu={() => setMenuOpen(false)} />
            </div>

            {/* Footer / Sign Out */}
            <div className="p-4 border-t border-gray-200 bg-white mt-auto sticky bottom-0 z-10 flex flex-col gap-3">
              {isAdmin && (
                <button
                  onClick={() => {
                    router.push("/admin");
                    setMenuOpen(false);
                  }}
                  className="w-full px-4 py-3 bg-gradient-to-r from-purple-50 to-white border border-purple-200 text-purple-700 font-medium rounded-xl hover:border-purple-300 hover:shadow-sm transition-all flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Admin Dashboard
                </button>
              )}
              <button
                onClick={() => {
                  signOut();
                  setMenuOpen(false);
                }}
                className="w-full px-4 py-3 bg-white border border-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-50 hover:border-gray-300 transition-colors shadow-sm flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Sign Out
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
