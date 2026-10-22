export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      profiles: {
        Row: {
          car: string
          display_name: string
          id: string
          phone: string
          plate: string
        }
        Insert: {
          car?: string
          display_name?: string
          id: string
          phone?: string
          plate?: string
        }
        Update: {
          car?: string
          display_name?: string
          id?: string
          phone?: string
          plate?: string
        }
        Relationships: []
      }
      shared_bookings: {
        Row: {
          created_at: string
          final_confirmed: boolean
          id: string
          ride_id: string
          seats: number
          user_id: string
        }
        Insert: {
          created_at?: string
          final_confirmed?: boolean
          id?: string
          ride_id: string
          seats: number
          user_id: string
        }
        Update: {
          created_at?: string
          final_confirmed?: boolean
          id?: string
          ride_id?: string
          seats?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shared_bookings_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "shared_rides"
            referencedColumns: ["id"]
          },
        ]
      }
      shared_rides: {
        Row: {
          created_at: string
          departure_at: string
          destination: string
          id: string
          origin: string
          owner_id: string
          ride_type: string
          state: string
          total_fare: number
        }
        Insert: {
          created_at?: string
          departure_at: string
          destination: string
          id?: string
          origin: string
          owner_id: string
          ride_type?: string
          state?: string
          total_fare: number
        }
        Update: {
          created_at?: string
          departure_at?: string
          destination?: string
          id?: string
          origin?: string
          owner_id?: string
          ride_type?: string
          state?: string
          total_fare?: number
        }
        Relationships: []
      }
      support_tickets: {
        Row: {
          body: string
          category: string
          created_at: string
          id: string
          status: string
          subject: string
          user_id: string
        }
        Insert: {
          body: string
          category: string
          created_at?: string
          id?: string
          status?: string
          subject: string
          user_id?: string
        }
        Update: {
          body?: string
          category?: string
          created_at?: string
          id?: string
          status?: string
          subject?: string
          user_id?: string
        }
        Relationships: []
      }
      trip_events: {
        Row: {
          actor_id: string
          agreed_fare: number
          commission: number
          created_at: string
          driver_net: number
          id: string
          status: string
          trip_id: string
        }
        Insert: {
          actor_id: string
          agreed_fare: number
          commission: number
          created_at?: string
          driver_net: number
          id?: string
          status: string
          trip_id: string
        }
        Update: {
          actor_id?: string
          agreed_fare?: number
          commission?: number
          created_at?: string
          driver_net?: number
          id?: string
          status?: string
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_events_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trips: {
        Row: {
          agreed_fare: number
          calculated: number
          commission: number
          created_at: string
          departure_at: string
          destination: string
          driver_id: string | null
          driver_net: number
          id: string
          km: number
          mountain: boolean
          night: boolean
          origin: string
          passenger_id: string
          passenger_name: string
          status: string
          suggested: number | null
          updated_at: string
        }
        Insert: {
          agreed_fare: number
          calculated: number
          commission: number
          created_at?: string
          departure_at: string
          destination: string
          driver_id?: string | null
          driver_net: number
          id?: string
          km: number
          mountain: boolean
          night: boolean
          origin: string
          passenger_id: string
          passenger_name: string
          status?: string
          suggested?: number | null
          updated_at?: string
        }
        Update: {
          agreed_fare?: number
          calculated?: number
          commission?: number
          created_at?: string
          departure_at?: string
          destination?: string
          driver_id?: string | null
          driver_net?: number
          id?: string
          km?: number
          mountain?: boolean
          night?: boolean
          origin?: string
          passenger_id?: string
          passenger_name?: string
          status?: string
          suggested?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      change_trip_status: {
        Args: { p_status: string; p_trip: string }
        Returns: undefined
      }
      confirm_shared_price: {
        Args: { p_amount: number; p_consent: boolean; p_ride: string }
        Returns: undefined
      }
      create_shared_ride: {
        Args: {
          p_consent: boolean
          p_departure: string
          p_destination: string
          p_fare: number
          p_origin: string
          p_seats: number
          p_type: string
        }
        Returns: string
      }
      create_trip: {
        Args: {
          p_departure: string
          p_destination: string
          p_km: number
          p_mountain: boolean
          p_night: boolean
          p_origin: string
          p_suggested?: number
        }
        Returns: string
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      join_shared_ride: {
        Args: {
          p_consent: boolean
          p_expected: number
          p_ride: string
          p_seats: number
        }
        Returns: undefined
      }
      lock_shared_ride: { Args: { p_ride: string }; Returns: undefined }
      register_driver: { Args: never; Returns: undefined }
      shared_listing: { Args: never; Returns: Json }
      trip_contacts: { Args: { p_trip: string }; Returns: Json }
      trip_fare: {
        Args: { p_km: number; p_mountain: boolean; p_night: boolean }
        Returns: number
      }
    }
    Enums: {
      app_role: "driver"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["driver"],
    },
  },
} as const
