"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { listYears, getActiveYear, selectYear, getSelectedYear, type RSOAnnee, type YearListResponse } from "@/lib/rso/annees";

interface YearContextType {
  selectedYear: number;
  activeYear: number;
  years: RSOAnnee[];
  setSelectedYear: (year: number) => void;
  loading: boolean;
  refreshYears: () => Promise<void>;
}

const YearContext = createContext<YearContextType | undefined>(undefined);

export function YearProvider({ children }: { children: ReactNode }) {
  const [years, setYears] = useState<RSOAnnee[]>([]);
  const [activeYear, setActiveYear] = useState<number>(new Date().getFullYear());
  const [selectedYear, setSelectedYearState] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const stored = getSelectedYear();
      return stored || new Date().getFullYear();
    }
    return new Date().getFullYear();
  });
  const [loading, setLoading] = useState(true);

  const loadYears = async () => {
    try {
      setLoading(true);
      
      // Add timeout to prevent infinite loading
      const timeoutPromise = new Promise<YearListResponse>((_, reject) => {
        setTimeout(() => reject(new Error('Timeout loading years')), 10000); // 10 seconds
      });
      
      const result = await Promise.race([listYears(), timeoutPromise]);
      setYears(result.annees);
      setActiveYear(result.activeYear);
      
      // If no stored year, use active year
      if (!getSelectedYear()) {
        setSelectedYearState(result.activeYear);
        selectYear(result.activeYear);
      } else {
        // Ensure stored year is valid
        const stored = getSelectedYear();
        if (stored) {
          setSelectedYearState(stored);
        }
      }
    } catch (error) {
      console.error("Error loading years:", error);
      // Fallback to current year if API fails
      const currentYear = new Date().getFullYear();
      setActiveYear(currentYear);
      setSelectedYearState(currentYear);
      // Ensure we have at least one year in the list
      if (years.length === 0) {
        setYears([{ id: 0, annee: currentYear, statut: 'active' }]);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadYears();
  }, []);

  const setSelectedYear = (year: number) => {
    setSelectedYearState(year);
    selectYear(year);
  };

  return (
    <YearContext.Provider
      value={{
        selectedYear,
        activeYear,
        years,
        setSelectedYear,
        loading,
        refreshYears: loadYears,
      }}
    >
      {children}
    </YearContext.Provider>
  );
}

export function useYear() {
  const context = useContext(YearContext);
  if (context === undefined) {
    throw new Error('useYear must be used within a YearProvider');
  }
  return context;
}

