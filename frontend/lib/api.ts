import { auth } from "./firebase";

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export async function fetchAPI(endpoint: string, options?: RequestInit) {
  const url = `${API_URL}${endpoint}`;
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  return response.json();
}

export async function authenticatedFetch(endpoint: string, options?: RequestInit) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) {
    throw new Error("Not authenticated");
  }
  const url = `${API_URL}${endpoint}`;
  const headers = {
    ...options?.headers,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  return response.json();
}

export { API_URL };