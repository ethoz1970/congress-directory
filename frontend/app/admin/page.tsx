"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/AuthContext";
import { authenticatedFetch } from "../../lib/api";
import DataTab from "./DataTab";

interface UserData {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string | null;
  role: string;
  verified: boolean;
  verificationStatus: string;
  createdAt: string | null;
  lastLogin: string | null;
  favoritesCount: number;
}

interface UserStats {
  total: number;
  byRole: { admin: number; public: number; rep: number };
  verified: number;
  pendingVerifications: number;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "N/A";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "N/A";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getTimeSince(dateStr: string | null): string {
  if (!dateStr) return "N/A";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "N/A";

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

function roleBadgeClasses(role: string): string {
  switch (role) {
    case "admin":
      return "bg-red-100 text-red-800";
    case "rep":
      return "bg-purple-100 text-purple-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

export default function AdminDashboard() {
  const { user, loading: authLoading, isAdmin } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState<UserData[]>([]);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<string>("createdAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [accessChecked, setAccessChecked] = useState(false);
  const [changingRole, setChangingRole] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"users" | "data">("users");

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      router.push("/");
      return;
    }

    if (!isAdmin) {
      router.push("/");
      return;
    }

    setAccessChecked(true);

    async function fetchData() {
      try {
        setLoading(true);
        const [usersData, statsData] = await Promise.all([
          authenticatedFetch("/api/admin/users"),
          authenticatedFetch("/api/admin/user-stats"),
        ]);
        setUsers(usersData);
        setStats(statsData);
        setError(null);
      } catch (err) {
        console.error("Error fetching admin data:", err);
        setError("Failed to load admin data");
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [user, authLoading, isAdmin, router]);

  const handleSetRole = async (uid: string, newRole: string) => {
    setChangingRole(uid);
    try {
      await authenticatedFetch("/api/admin/set-role", {
        method: "POST",
        body: JSON.stringify({ uid, role: newRole }),
      });
      // Update local state
      setUsers(prev => prev.map(u => u.uid === uid ? { ...u, role: newRole } : u));
      // Refresh stats
      const statsData = await authenticatedFetch("/api/admin/user-stats");
      setStats(statsData);
    } catch (err) {
      console.error("Error setting role:", err);
    } finally {
      setChangingRole(null);
    }
  };

  const sortedUsers = [...users].sort((a, b) => {
    let comparison = 0;

    switch (sortBy) {
      case "name":
        comparison = (a.displayName || "").localeCompare(b.displayName || "");
        break;
      case "email":
        comparison = a.email.localeCompare(b.email);
        break;
      case "role":
        comparison = (a.role || "public").localeCompare(b.role || "public");
        break;
      case "createdAt":
        const createdA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const createdB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        comparison = createdB - createdA;
        break;
      case "lastLogin":
        const loginA = a.lastLogin ? new Date(a.lastLogin).getTime() : 0;
        const loginB = b.lastLogin ? new Date(b.lastLogin).getTime() : 0;
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
            {sortDirection === "asc" ? "^" : "v"}
          </span>
        )}
      </div>
    </th>
  );

  if (authLoading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-xl text-gray-500">Loading...</p>
      </main>
    );
  }

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
        <div className="max-w-7xl mx-auto px-4 pt-6 pb-0">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
              <p className="text-gray-600 mt-1">
                {stats?.total || users.length} registered user{(stats?.total || users.length) !== 1 ? "s" : ""}
              </p>
            </div>
            <button
              onClick={() => router.push("/")}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
            >
              &larr; Back to Directory
            </button>
          </div>
          {/* Tab Bar */}
          <div className="flex gap-1 border-b border-gray-200">
            {(["users", "data"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-5 py-2.5 text-sm font-medium capitalize border-b-2 -mb-px transition-colors ${
                  activeTab === tab
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-800"
                }`}
              >
                {tab === "users" ? "👥 Users" : "🗄️ Data"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Data Tab */}
      {activeTab === "data" && (
        <div className="max-w-7xl mx-auto px-4 py-6">
          <DataTab />
        </div>
      )}

      {/* Users Tab */}
      {activeTab === "users" && (
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow p-6">
            <p className="text-sm text-gray-500 uppercase">Total Users</p>
            <p className="text-3xl font-bold text-gray-900">{stats?.total || 0}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <p className="text-sm text-gray-500 uppercase">Public</p>
            <p className="text-3xl font-bold text-gray-600">{stats?.byRole.public || 0}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <p className="text-sm text-gray-500 uppercase">Reps</p>
            <p className="text-3xl font-bold text-purple-600">{stats?.byRole.rep || 0}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <p className="text-sm text-gray-500 uppercase">Admins</p>
            <p className="text-3xl font-bold text-red-600">{stats?.byRole.admin || 0}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <p className="text-sm text-gray-500 uppercase">Verified</p>
            <p className="text-3xl font-bold text-green-600">{stats?.verified || 0}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <p className="text-sm text-gray-500 uppercase">Pending</p>
            <p className="text-3xl font-bold text-amber-600">{stats?.pendingVerifications || 0}</p>
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
                    <SortHeader column="role" label="Role" />
                    <SortHeader column="favorites" label="Favorites" />
                    <SortHeader column="createdAt" label="Signed Up" />
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Member For
                    </th>
                    <SortHeader column="lastLogin" label="Last Login" />
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Last Active
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
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
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${roleBadgeClasses(userData.role)}`}>
                          {userData.role || "public"}
                        </span>
                        {userData.verified && (
                          <span className="ml-1 text-green-500" title="Verified">
                            &#10003;
                          </span>
                        )}
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
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <select
                          value={userData.role || "public"}
                          onChange={(e) => handleSetRole(userData.uid, e.target.value)}
                          disabled={changingRole === userData.uid}
                          className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                        >
                          <option value="public">Public</option>
                          <option value="rep">Rep</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      )}
    </main>
  );
}
