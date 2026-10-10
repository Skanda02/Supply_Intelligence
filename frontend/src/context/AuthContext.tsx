import React, { createContext, useContext, useEffect, useState } from "react";

import { SUPABASE_CONFIGURED, supabase } from "../api/supabase";
import { TOKEN_KEY } from "../api/authToken";

export interface HospitalProfile {
  id: string; // real hospital_id from the dataset, e.g. "H01"
  name: string;
  code: string;
  email: string;
  role: string;
  userName: string;
  region: string;
  bedCapacity: number;
  tier: string;
  avatarColor: string;
  token?: string;
}

// Mirrors the seeded hospitals in dataset (H01–H04)
export const PRESET_HOSPITALS: HospitalProfile[] = [
  {
    id: "H01",
    name: "Hospital A",
    code: "H01",
    email: "hospital-a@medipulse.health",
    role: "Supply Chain Director",
    userName: "Dr. Marcus Vance",
    region: "Bengaluru",
    bedCapacity: 250,
    tier: "Tier 1 Trauma Center",
    avatarColor: "from-blue-600 to-indigo-600",
  },
  {
    id: "H02",
    name: "Hospital B",
    code: "H02",
    email: "hospital-b@medipulse.health",
    role: "Lead Pharmacist",
    userName: "Elena Rostova, PharmD",
    region: "Mangaluru",
    bedCapacity: 400,
    tier: "Regional Community Care",
    avatarColor: "from-cyan-600 to-teal-600",
  },
  {
    id: "H03",
    name: "Hospital C",
    code: "H03",
    email: "hospital-c@medipulse.health",
    role: "Clinical Procurement Head",
    userName: "Dr. Julian Mercer",
    region: "Mysuru",
    bedCapacity: 180,
    tier: "Tertiary Referral & Outbreak",
    avatarColor: "from-purple-600 to-indigo-600",
  },
  {
    id: "H04",
    name: "Hospital D",
    code: "H04",
    email: "hospital-d@medipulse.health",
    role: "Operations Supervisor",
    userName: "Clara Hughes, RN",
    region: "Hubballi",
    bedCapacity: 600,
    tier: "Suburban Urgent Care",
    avatarColor: "from-emerald-600 to-teal-600",
  },
];

export interface SignUpInput {
  name: string;
  email: string;
  password: string;
  facilityId: string;
  role: string;
}

export interface SignUpResult {
  error: string | null;
  needsEmailConfirmation: boolean;
}

interface AuthContextType {
  user: HospitalProfile | null;
  token: string | null;
  login: (emailOrId: string, password?: string) => Promise<boolean>;
  signUp: (input: SignUpInput) => Promise<SignUpResult>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const STORAGE_KEY = "medipulse_auth_user";

// AUTH DISABLED FOR TESTING — when true, a preset facility is used as the
// logged-in user so all pages load without signing in.
// To re-enable auth: set this to false.
const DEV_BYPASS_AUTH = true;
const BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:8000";

function fallbackFacilityFromQuery(query: string): string | null {
  const normalized = query.toLowerCase();
  const preset = PRESET_HOSPITALS.find((h) => h.email.toLowerCase() === normalized);
  if (preset) return preset.id;
  const match = normalized.match(/^h(\d{2})/);
  if (match) return `H${match[1]}`;
  return null;
}

function profileFromMeta(
  meta: Record<string, unknown>,
  email: string | undefined,
  facilityId: string,
): HospitalProfile {
  const name = typeof meta.name === "string" ? meta.name : (email?.split("@")[0] ?? facilityId);
  const role = typeof meta.role === "string" ? meta.role : "FACILITY_MANAGER";
  const preset = PRESET_HOSPITALS.find((h) => h.id === facilityId);
  return {
    id: facilityId,
    name: preset?.name ?? facilityId,
    code: facilityId,
    email: email ?? `${facilityId.toLowerCase()}@medipulse.health`,
    role,
    userName: name,
    region: preset?.region ?? "Regional Network",
    bedCapacity: preset?.bedCapacity ?? 250,
    tier: preset?.tier ?? "General Hospital",
    avatarColor: preset?.avatarColor ?? "from-blue-600 to-indigo-600",
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => {
    return localStorage.getItem(TOKEN_KEY);
  });

  // AUTH DISABLED FOR TESTING — default to a preset facility so pages gated on
  // `user?.id` fetch data without logging in.
  // To re-enable auth: set DEV_BYPASS_AUTH = false below.
  const [user, setUser] = useState<HospitalProfile | null>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as HospitalProfile;
        const match = PRESET_HOSPITALS.find((h) => h.id === parsed.id);
        if (match) {
          return { ...match, ...parsed };
        }
      }
    } catch {
      // Fallback
    }
    if (DEV_BYPASS_AUTH) {
      return PRESET_HOSPITALS[0];
    }
    return null;
  });

  // Hydrate a persisted Supabase session on reload when no app token is stored.
  useEffect(() => {
    if (!SUPABASE_CONFIGURED || !supabase || localStorage.getItem(TOKEN_KEY)) {
      return;
    }
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active || !data.session) return;
      const session = data.session;
      const meta = (session.user?.user_metadata ?? {}) as Record<string, unknown>;
      const facilityId =
        typeof meta.facility_id === "string"
          ? meta.facility_id
          : (fallbackFacilityFromQuery(session.user?.email ?? "") ?? "H01");
      setToken(session.access_token);
      setUser({
        ...profileFromMeta(meta, session.user?.email, facilityId),
        token: session.access_token,
      });
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (user) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [user]);

  useEffect(() => {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  }, [token]);

  const login = async (emailOrId: string, password = "supplyPass2026!"): Promise<boolean> => {
    const query = emailOrId.trim();

    if (SUPABASE_CONFIGURED && supabase) {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: query,
        password,
      });
      if (error || !data.session) return false;
      const session = data.session;
      const meta = (session.user?.user_metadata ?? {}) as Record<string, unknown>;
      const facilityId =
        typeof meta.facility_id === "string"
          ? meta.facility_id
          : (fallbackFacilityFromQuery(session.user?.email ?? "") ?? "H01");
      setToken(session.access_token);
      setUser({
        ...profileFromMeta(meta, session.user?.email, facilityId),
        token: session.access_token,
      });
      return true;
    }

    try {
      const res = await fetch(`${BASE_URL}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: query, password }),
      });

      if (res.ok) {
        const data = await res.json();
        const jwtToken = data.access_token;
        setToken(jwtToken);

        const facilityId = data.user.facility_id;
        const match = PRESET_HOSPITALS.find((h) => h.id === facilityId) || {
          id: facilityId || "H01",
          name: data.user.hospital_name || "Hospital A",
          code: facilityId || "H01",
          email: data.user.email,
          role: data.user.role,
          userName: data.user.name,
          region: data.user.city || "Regional Network",
          bedCapacity: data.user.bed_capacity || 250,
          tier: "General Hospital",
          avatarColor: "from-blue-600 to-indigo-600",
        };

        setUser({ ...match, token: jwtToken });
        return true;
      }
    } catch {
      // Network failure
    }

    // Local credential check (offline fallback for demo)
    const normalized = query.toLowerCase();
    const found = PRESET_HOSPITALS.find(
      (h) =>
        h.id.toLowerCase() === normalized ||
        h.email.toLowerCase() === normalized ||
        h.name.toLowerCase() === normalized ||
        h.code.toLowerCase() === normalized,
    );

    if (found && (password === "supplyPass2026!" || password === "password" || password === "hospital123!")) {
      setUser(found);
      return true;
    }

    return false;
  };

  const signUp = async (input: SignUpInput): Promise<SignUpResult> => {
    if (!SUPABASE_CONFIGURED || !supabase) {
      return {
        error: "Supabase Auth is not configured on this deployment.",
        needsEmailConfirmation: false,
      };
    }

    const { data, error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        data: {
          facility_id: input.facilityId,
          role: input.role,
          name: input.name,
        },
      },
    });

    if (error) {
      return { error: error.message, needsEmailConfirmation: false };
    }

    // Email confirmation enabled → user must verify before first sign-in.
    if (!data.session) {
      return { error: null, needsEmailConfirmation: true };
    }

    const meta = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
    setToken(data.session.access_token);
    setUser({
      ...profileFromMeta(meta, data.user?.email, input.facilityId),
      token: data.session.access_token,
    });
    return { error: null, needsEmailConfirmation: false };
  };

  const logout = async () => {
    if (SUPABASE_CONFIGURED && supabase) {
      await supabase.auth.signOut();
    }
    setUser(null);
    setToken(null);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(TOKEN_KEY);
  };

  return (
    <AuthContext.Provider value={{ user, token, login, signUp, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}