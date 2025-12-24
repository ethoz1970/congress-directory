const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export async function fetchAPI(endpoint: string, options?: RequestInit) {
  const url = `${API_URL}${endpoint}`;
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  return response.json();
}

export { API_URL };