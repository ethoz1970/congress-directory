"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/AuthContext";
import { db } from "../../lib/firebase";
import { collection, getDocs, query, orderBy } from "firebase/firestore";

interface UserData {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string | null;
  createdAt: Date | null;
  lastLogin: Date | null;
  favoritesCount: number;
}

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

function formatDate(date: Date | null): string {
  if (!date) return "N/A";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getTimeSince(date: Date | null): string {
  if (!date) return "N/A";
  
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) {
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours === 0) {
      const diffMins = Math.floor(diffMs / (1000 * 60));
      return `${diffMins} minute${diffMins !== 1 ? "s" : ""}`;
    }
    return `${diffHours} hour${diffHours !== 1 ? "s" : ""}`;
  } else if (diffDays < 30) {
    return `${diffDays} day${diffDays !== 1 ? "s" : ""}`;
  } else if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    return `${months} month${months !== 1 ? "s" : ""}`;
  } else {
    const years = Math.floor(diffDays / 365);
    const remainingMonths = Math.floor((diffDays % 365) / 30);
    if (remainingMonths > 0) {
      return `${years} year${years !== 1 ? "s" : ""}, ${remainingMonths} month${remainingMonths !== 1 ? "s" : ""}`;
    }
    return `${years} year${years !== 1 ? "s" : ""}`;
  }
}

export default function AdminDashboard() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<string>("createdAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [accessChecked, setAccessChecked] = useState(false);

  const userEmail = user?.email || "";
  const isAdmin = isAdminEmail(userEmail);

  useEffect(() => {
    // Wait for auth to finish loading
    if (authLoading) return;
    
    // If no user, redirect to home
    if (!user) {
      router.push("/");
      return;
    }

    // Check admin status
    const email = user.email || "";
    const hasAdminAccess = isAdminEmail(email);
    
    console.log("Admin check:", { email, hasAdminAccess, ADMIN_EMAILS }); // Debug log
    
    if (!hasAdminAccess) {
      router.push("/");
      return;
    }
    
    setAccessChecked(true);

    async function fetchUsers() {
      try {
        setLoading(true);
        
        // Fetch all users
        const usersSnapshot = await getDocs(collection(db, "users"));
        const usersData: UserData[] = [];
        
        // Fetch favorites counts
        const favoritesSnapshot = await getDocs(collection(db, "favorites"));
        const favoritesByUser: Record<string, number> = {};
        
        favoritesSnapshot.forEach((doc) => {
          const userId = doc.data().userId;
          favoritesByUser[userId] = (favoritesByUser[userId] || 0) + 1;
        });
        
        usersSnapshot.forEach((doc) => {
          const data = doc.to_dict ? doc.to_dict() : doc.data();
          const createdAt = data.createdAt?.toDate?.() || null;
          const lastLogin = data.lastLogin?.toDate?.() || null;
          
          usersData.push({
            uid: doc.id,
            email: data.email || "",
            displayName: data.displayName || "",
            photoURL: data.photoURL || null,
            createdAt,
            lastLogin,
            favoritesCount: favoritesByUser[doc.id] || 0,
          });
        });
        
        setUsers(usersData);
        setError(null);
      } catch (err) {
        console.error("Error fetching users:", err);
        setError("Failed to load users");
      } finally {
        setLoading(false);
      }
    }

    fetchUsers();
  }, [user, authLoading, router]);

  const sortedUsers = [...users].sort((a, b) => {
    let comparison = 0;
    
    switch (sortBy) {
      case "name":
        comparison = (a.displayName || "").localeCompare(b.displayName || "");
        break;
      case "email":
        comparison = a.email.localeCompare(b.email);
        break;
      case "createdAt":
        const createdA = a.createdAt?.getTime() || 0;
        const createdB = b.createdAt?.getTime() || 0;
        comparison = createdB - createdA;
        break;
      case "lastLogin":
        const loginA = a.lastLogin?.getTime() || 0;
        const loginB = b.lastLogin?.getTime() || 0;
        comparison = loginB - loginA;
        break;
      case "favorites":
        comparison = b.favoritesCount - a.favoritesCount;
        break;
      default:
        comparison = 0;
    }
    
    return sortDirection === "asc" ? -comparison : comparison;
  });

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortDirection("desc");
    }
  };

  const SortHeader = ({ column, label }: { column: string; label: string }) => (
    <th
      onClick={() => handleSort(column)}
      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
    >
      <div className="flex items-center gap-1">
        {label}
        {sortBy === column && (
          <span className="text-blue-600">
            {sortDirection === "asc" ? "↑" : "↓"}
          </span>
        )}
      </div>
    </th>
  );

  // Show loading while auth is loading
  if (authLoading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-xl text-gray-500">Loading...</p>
      </main>
    );
  }

  // Show loading while checking access or fetching data
  if (!accessChecked || loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-xl text-gray-500">Loading...</p>
          {user && (
            <p className="text-sm text-gray-400 mt-2">Logged in as: {user.email}</p>
          )}
        </div>
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-xl text-red-600">Access denied</p>
          <p className="text-sm text-gray-500 mt-2">
            {user?.email || "Not logged in"} is not an admin
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
              <p className="text-gray-600 mt-1">
                {users.length} registered user{users.length !== 1 ? "s" : ""}
              </p>
            </div>
            <button
              onClick={() => router.push("/")}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
            >
              ← Back to Directory
            </button>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow p-6">
            <p className="text-sm text-gray-500 uppercase">Total Users</p>
            <p className="text-3xl font-bold text-gray-900">{users.length}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <p className="text-sm text-gray-500 uppercase">Total Favorites</p>
            <p className="text-3xl font-bold text-blue-600">
              {users.reduce((sum, u) => sum + u.favoritesCount, 0)}
            </p>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <p className="text-sm text-gray-500 uppercase">Active Today</p>
            <p className="text-3xl font-bold text-green-600">
              {users.filter(u => {
                if (!u.lastLogin) return false;
                const today = new Date();
                return u.lastLogin.toDateString() === today.toDateString();
              }).length}
            </p>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <p className="text-sm text-gray-500 uppercase">Avg Favorites/User</p>
            <p className="text-3xl font-bold text-purple-600">
              {users.length > 0 
                ? (users.reduce((sum, u) => sum + u.favoritesCount, 0) / users.length).toFixed(1)
                : 0
              }
            </p>
          </div>
        </div>

        {/* Users Table */}
        {error ? (
          <div className="bg-red-50 text-red-600 p-4 rounded-lg">{error}</div>
        ) : (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      User
                    </th>
                    <SortHeader column="email" label="Email" />
                    <SortHeader column="favorites" label="Favorites" />
                    <SortHeader column="createdAt" label="Signed Up" />
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Member For
                    </th>
                    <SortHeader column="lastLogin" label="Last Login" />
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Last Active
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {sortedUsers.map((userData) => (
                    <tr key={userData.uid} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          {userData.photoURL ? (
                            <img
                              src={userData.photoURL}
                              alt={userData.displayName}
                              className="w-10 h-10 rounded-full"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center text-white font-medium">
                              {userData.displayName?.charAt(0) || userData.email?.charAt(0) || "?"}
                            </div>
                          )}
                          <div className="ml-3">
                            <p className="text-sm font-medium text-gray-900">
                              {userData.displayName || "No name"}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {userData.email}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          userData.favoritesCount > 10
                            ? "bg-green-100 text-green-800"
                            : userData.favoritesCount > 0
                              ? "bg-blue-100 text-blue-800"
                              : "bg-gray-100 text-gray-800"
                        }`}>
                          {userData.favoritesCount}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {formatDate(userData.createdAt)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {getTimeSince(userData.createdAt)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {formatDate(userData.lastLogin)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {getTimeSince(userData.lastLogin)} ago
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
