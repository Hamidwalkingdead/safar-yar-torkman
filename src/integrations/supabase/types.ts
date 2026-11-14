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
      driver_documents: {
        Row: {
          created_at: string
          kind: string
          path: string
          user_id: string
        }
        Insert: {
          created_at?: string
          kind: string
          path: string
          user_id: string
        }
        Update: {
          created_at?: string
          kind?: string
          path?: string
          user_id?: string
        }
        Relationships: []
      }
      driver_ratings: {
        Row: { created_at: string; driver_id: string; id: string; passenger_id: string; shared_ride_id: string | null; stars: number; trip_id: string | null }
        Insert: { created_at?: string; driver_id: string; id?: string; passenger_id: string; shared_ride_id?: string | null; stars: number; trip_id?: string | null }
        Update: { created_at?: string; driver_id?: string; id?: string; passenger_id?: string; shared_ride_id?: string | null; stars?: number; trip_id?: string | null }
        Relationships: [
          { foreignKeyName: "driver_ratings_trip_id_fkey"; columns: ["trip_id"]; isOneToOne: false; referencedRelation: "trips"; referencedColumns: ["id"] },
          { foreignKeyName: "driver_ratings_shared_ride_id_fkey"; columns: ["shared_ride_id"]; isOneToOne: false; referencedRelation: "shared_rides"; referencedColumns: ["id"] },
          { foreignKeyName: "driver_ratings_passenger_id_fkey"; columns: ["passenger_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "driver_ratings_driver_id_fkey"; columns: ["driver_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] }
        ]
      }
      driver_verifications: {
        Row: {
          note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_verifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      passenger_cancellation_debts: {
        Row: {
          created_at: string
          driver_amount: number
          driver_id: string
          id: string
          passenger_id: string
          penalty_amount: number
          platform_amount: number
          settled_at: string | null
          settled_by_trip_id: string | null
          source_trip_id: string
          status: string
        }
        Insert: {
          created_at?: string
          driver_amount: number
          driver_id: string
          id?: string
          passenger_id: string
          penalty_amount: number
          platform_amount: number
          settled_at?: string | null
          settled_by_trip_id?: string | null
          source_trip_id: string
          status?: string
        }
        Update: {
          created_at?: string
          driver_amount?: number
          driver_id?: string
          id?: string
          passenger_id?: string
          penalty_amount?: number
          platform_amount?: number
          settled_at?: string | null
          settled_by_trip_id?: string | null
          source_trip_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "passenger_cancellation_debts_settled_by_trip_id_fkey"
            columns: ["settled_by_trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "passenger_cancellation_debts_source_trip_id_fkey"
            columns: ["source_trip_id"]
            isOneToOne: true
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_billing_features: {
        Row: { bank_gateway_enabled: boolean; id: boolean; updated_at: string; wallet_enabled: boolean }
        Insert: { bank_gateway_enabled?: boolean; id?: boolean; updated_at?: string; wallet_enabled?: boolean }
        Update: { bank_gateway_enabled?: boolean; id?: boolean; updated_at?: string; wallet_enabled?: boolean }
        Relationships: []
      }
      platform_revenue: {
        Row: {
          balance: number
          id: boolean
          updated_at: string
        }
        Insert: {
          balance?: number
          id?: boolean
          updated_at?: string
        }
        Update: {
          balance?: number
          id?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          car: string
          display_name: string
          emergency_phone: string
          first_name: string
          id: string
          last_name: string
          phone: string
          plate: string
        }
        Insert: {
          car?: string
          display_name?: string
          emergency_phone?: string
          first_name?: string
          id: string
          last_name?: string
          phone?: string
          plate?: string
        }
        Update: {
          car?: string
          display_name?: string
          emergency_phone?: string
          first_name?: string
          id?: string
          last_name?: string
          phone?: string
          plate?: string
        }
        Relationships: []
      }
      shared_ride_locations: {
        Row: { accuracy_m: number | null; heading_deg: number | null; latitude: number; longitude: number; ride_id: string; speed_mps: number | null; updated_at: string; user_id: string }
        Insert: { accuracy_m?: number | null; heading_deg?: number | null; latitude: number; longitude: number; ride_id: string; speed_mps?: number | null; updated_at?: string; user_id: string }
        Update: { accuracy_m?: number | null; heading_deg?: number | null; latitude?: number; longitude?: number; ride_id?: string; speed_mps?: number | null; updated_at?: string; user_id?: string }
        Relationships: [{ foreignKeyName: "shared_ride_locations_ride_id_fkey"; columns: ["ride_id"]; isOneToOne: false; referencedRelation: "shared_rides"; referencedColumns: ["id"] }]
      }
      shared_ride_messages: {
        Row: { audio_path: string | null; body: string | null; created_at: string; id: string; ride_id: string; sender_id: string }
        Insert: { audio_path?: string | null; body?: string | null; created_at?: string; id?: string; ride_id: string; sender_id: string }
        Update: { audio_path?: string | null; body?: string | null; created_at?: string; id?: string; ride_id?: string; sender_id?: string }
        Relationships: [{ foreignKeyName: "shared_ride_messages_ride_id_fkey"; columns: ["ride_id"]; isOneToOne: false; referencedRelation: "shared_rides"; referencedColumns: ["id"] }]
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
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          created_at: string
          departure_at: string
          destination: string
          driver_accepted_at: string | null
          driver_id: string | null
          id: string
          origin: string
          owner_id: string
          ride_type: string
          started_at: string | null
          state: string
          total_fare: number
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          completed_at?: string | null
          created_at?: string
          departure_at: string
          destination: string
          driver_accepted_at?: string | null
          driver_id?: string | null
          id?: string
          origin: string
          owner_id: string
          ride_type?: string
          started_at?: string | null
          state?: string
          total_fare: number
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          completed_at?: string | null
          created_at?: string
          departure_at?: string
          destination?: string
          driver_accepted_at?: string | null
          driver_id?: string | null
          id?: string
          origin?: string
          owner_id?: string
          ride_type?: string
          started_at?: string | null
          state?: string
          total_fare?: number
        }
        Relationships: [
          {
            foreignKeyName: "shared_rides_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      support_ticket_replies: {
        Row: { body: string; created_at: string; id: string; sender_id: string; ticket_id: string }
        Insert: { body: string; created_at?: string; id?: string; sender_id?: string; ticket_id: string }
        Update: { body?: string; created_at?: string; id?: string; sender_id?: string; ticket_id?: string }
        Relationships: [{ foreignKeyName: "support_ticket_replies_ticket_id_fkey"; columns: ["ticket_id"]; isOneToOne: false; referencedRelation: "support_tickets"; referencedColumns: ["id"] }]
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
      trip_messages: {
        Row: {
          audio_path: string | null
          body: string | null
          created_at: string
          id: string
          sender_id: string
          trip_id: string
        }
        Insert: {
          audio_path?: string | null
          body?: string | null
          created_at?: string
          id?: string
          sender_id: string
          trip_id: string
        }
        Update: {
          audio_path?: string | null
          body?: string | null
          created_at?: string
          id?: string
          sender_id?: string
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_messages_trip_id_fkey"
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
          origin_lat: number | null
          origin_lng: number | null
          destination_lat: number | null
          destination_lng: number | null
          passenger_id: string
          passenger_name: string
          payment_method: string
          prior_debt_amount: number
          ride_type: string
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
          origin_lat?: number | null
          origin_lng?: number | null
          destination_lat?: number | null
          destination_lng?: number | null
          passenger_id: string
          passenger_name: string
          payment_method?: string
          prior_debt_amount?: number
          ride_type?: string
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
          origin_lat?: number | null
          origin_lng?: number | null
          destination_lat?: number | null
          destination_lng?: number | null
          passenger_id?: string
          passenger_name?: string
          payment_method?: string
          prior_debt_amount?: number
          ride_type?: string
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
      wallet_accounts: {
        Row: {
          balance: number
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      wallet_transactions: {
        Row: {
          amount: number
          created_at: string
          description: string
          id: string
          kind: string
          reference_id: string | null
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          description: string
          id?: string
          kind: string
          reference_id?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string
          id?: string
          kind?: string
          reference_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      wallet_withdrawal_requests: {
        Row: {
          amount: number
          card_number: string
          created_at: string
          id: string
          note: string | null
          reviewed_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          amount: number
          card_number: string
          created_at?: string
          id?: string
          note?: string | null
          reviewed_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          amount?: number
          card_number?: string
          created_at?: string
          id?: string
          note?: string | null
          reviewed_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_shared_ride: { Args: { p_ride: string }; Returns: undefined }
      admin_review_driver: {
        Args: { p_note?: string; p_status: string; p_user: string }
        Returns: undefined
      }
      admin_review_wallet_withdrawal: {
        Args: { p_note?: string; p_request: string; p_status: string }
        Returns: undefined
      }
      admin_set_ticket_status: {
        Args: { p_status: string; p_ticket: string }
        Returns: undefined
      }
      admin_set_billing_features: { Args: { p_bank_gateway_enabled?: boolean; p_wallet_enabled: boolean }; Returns: undefined }
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
          p_destination_lat: number
          p_destination_lng: number
          p_km: number
          p_mountain: boolean
          p_night: boolean
          p_origin: string
          p_origin_lat: number
          p_origin_lng: number
          p_payment_method: string
          p_ride_type: string
          p_suggested: number | null
        }
        Returns: string
      }
      driver_shared_requests: { Args: never; Returns: Json }
      driver_enroute_candidates: { Args: { p_primary_trip: string }; Returns: Json }
      driver_enroute_parent: { Args: { p_secondary_trip: string }; Returns: string }
      clear_my_emergency_phone: { Args: never; Returns: undefined }
      get_my_emergency_phone: { Args: never; Returns: string }
      get_billing_features: { Args: never; Returns: Json }
      get_passenger_cancellation_debt: { Args: never; Returns: number }
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
      reply_support_ticket: { Args: { p_body: string; p_ticket: string }; Returns: string }
      request_wallet_withdrawal: {
        Args: { p_amount: number; p_card: string }
        Returns: string
      }
      cancel_shared_ride: { Args: { p_reason?: string | null; p_ride: string }; Returns: undefined }
      complete_shared_ride: { Args: { p_ride: string }; Returns: undefined }
      start_shared_ride: { Args: { p_ride: string }; Returns: undefined }
      shared_driver_status: { Args: { p_ride: string }; Returns: Json }
      driver_assigned_shared_rides: { Args: never; Returns: Json }
      send_shared_ride_message: { Args: { p_body: string; p_ride: string }; Returns: string }
      send_shared_ride_voice: { Args: { p_audio_path: string; p_ride: string }; Returns: string }
      upsert_shared_ride_location: { Args: { p_accuracy?: number | null; p_heading?: number | null; p_latitude: number; p_longitude: number; p_ride: string; p_speed?: number | null }; Returns: undefined }
      shared_listing: { Args: never; Returns: Json }
      can_view_trip_driver_selfie: { Args: { p_path: string }; Returns: boolean }
      submit_driver_rating: { Args: { p_stars: number; p_trip: string }; Returns: string }
      submit_shared_driver_rating: { Args: { p_ride: string; p_stars: number }; Returns: string }
      trip_contacts: { Args: { p_trip: string }; Returns: Json }
      trip_fare: {
        Args: { p_km: number; p_mountain: boolean; p_night: boolean }
        Returns: number
      }
    }
    Enums: {
      app_role: "driver" | "admin"
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
      app_role: ["driver", "admin"],
    },
  },
} as const
