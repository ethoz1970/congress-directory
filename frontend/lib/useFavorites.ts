"use client";

import { useState, useEffect } from "react";
import { useAuth } from "./AuthContext";
import { db } from "./firebase";
import { 
  collection, 
  doc, 
  setDoc, 
  deleteDoc, 
  onSnapshot,
  query,
  where 
} from "firebase/firestore";

export function useFavorites() {
  const { user } = useAuth();
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setFavorites(new Set());
      setLoading(false);
      return;
    }

    // Subscribe to user's favorites
    const q = query(
      collection(db, "favorites"),
      where("userId", "==", user.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const favSet = new Set<string>();
      snapshot.forEach((doc) => {
        favSet.add(doc.data().bioguide_id);
      });
      setFavorites(favSet);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  const toggleFavorite = async (bioguide_id: string) => {
    if (!user) return;

    const docId = `${user.uid}_${bioguide_id}`;
    const docRef = doc(db, "favorites", docId);

    if (favorites.has(bioguide_id)) {
      // Remove favorite
      await deleteDoc(docRef);
    } else {
      // Add favorite
      await setDoc(docRef, {
        userId: user.uid,
        bioguide_id: bioguide_id,
        createdAt: new Date()
      });
    }
  };

  const isFavorite = (bioguide_id: string) => favorites.has(bioguide_id);

  return { favorites, toggleFavorite, isFavorite, loading };
}
