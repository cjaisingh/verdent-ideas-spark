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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      capabilities: {
        Row: {
          created_at: string
          description: string | null
          id: string
          inputs_required: Json
          name: string
          outputs_provided: Json
          owning_module: string | null
          status: Database["public"]["Enums"]["capability_status"]
          updated_at: string
          version: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id: string
          inputs_required?: Json
          name: string
          outputs_provided?: Json
          owning_module?: string | null
          status?: Database["public"]["Enums"]["capability_status"]
          updated_at?: string
          version?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          inputs_required?: Json
          name?: string
          outputs_provided?: Json
          owning_module?: string | null
          status?: Database["public"]["Enums"]["capability_status"]
          updated_at?: string
          version?: string
        }
        Relationships: []
      }
      capability_connectors: {
        Row: {
          capability_id: string
          connector_name: string
          id: string
          notes: string | null
        }
        Insert: {
          capability_id: string
          connector_name: string
          id?: string
          notes?: string | null
        }
        Update: {
          capability_id?: string
          connector_name?: string
          id?: string
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "capability_connectors_capability_id_fkey"
            columns: ["capability_id"]
            isOneToOne: false
            referencedRelation: "capabilities"
            referencedColumns: ["id"]
          },
        ]
      }
      capability_events: {
        Row: {
          actor: string | null
          capability_id: string
          created_at: string
          event_type: string
          id: string
          payload: Json
        }
        Insert: {
          actor?: string | null
          capability_id: string
          created_at?: string
          event_type: string
          id?: string
          payload?: Json
        }
        Update: {
          actor?: string | null
          capability_id?: string
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json
        }
        Relationships: []
      }
      idempotency_keys: {
        Row: {
          created_at: string
          id: string
          key: string
          response: Json
          scope: string
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          response: Json
          scope: string
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          response?: Json
          scope?: string
          tenant_id?: string | null
        }
        Relationships: []
      }
      okr_measurements: {
        Row: {
          attribution_rules: Json
          baseline: number | null
          cadence: string | null
          created_at: string
          data_sources: Json
          id: string
          metric_name: string
          okr_node_id: string
          required_capabilities: string[]
          target: number | null
          unit: string | null
        }
        Insert: {
          attribution_rules?: Json
          baseline?: number | null
          cadence?: string | null
          created_at?: string
          data_sources?: Json
          id?: string
          metric_name: string
          okr_node_id: string
          required_capabilities?: string[]
          target?: number | null
          unit?: string | null
        }
        Update: {
          attribution_rules?: Json
          baseline?: number | null
          cadence?: string | null
          created_at?: string
          data_sources?: Json
          id?: string
          metric_name?: string
          okr_node_id?: string
          required_capabilities?: string[]
          target?: number | null
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "okr_measurements_okr_node_id_fkey"
            columns: ["okr_node_id"]
            isOneToOne: true
            referencedRelation: "okr_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      okr_node_events: {
        Row: {
          actor: string | null
          created_at: string
          event_type: string
          id: string
          okr_node_id: string
          payload: Json
          tenant_id: string
        }
        Insert: {
          actor?: string | null
          created_at?: string
          event_type: string
          id?: string
          okr_node_id: string
          payload?: Json
          tenant_id: string
        }
        Update: {
          actor?: string | null
          created_at?: string
          event_type?: string
          id?: string
          okr_node_id?: string
          payload?: Json
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "okr_node_events_okr_node_id_fkey"
            columns: ["okr_node_id"]
            isOneToOne: false
            referencedRelation: "okr_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "okr_node_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      okr_nodes: {
        Row: {
          created_at: string
          created_by: Database["public"]["Enums"]["okr_creator"]
          description: string | null
          id: string
          kind: Database["public"]["Enums"]["okr_kind"]
          parent_id: string | null
          spawned_from_reason: string | null
          status: Database["public"]["Enums"]["okr_status"]
          superseded_by: string | null
          tenant_id: string
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: Database["public"]["Enums"]["okr_creator"]
          description?: string | null
          id?: string
          kind: Database["public"]["Enums"]["okr_kind"]
          parent_id?: string | null
          spawned_from_reason?: string | null
          status?: Database["public"]["Enums"]["okr_status"]
          superseded_by?: string | null
          tenant_id: string
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: Database["public"]["Enums"]["okr_creator"]
          description?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["okr_kind"]
          parent_id?: string | null
          spawned_from_reason?: string | null
          status?: Database["public"]["Enums"]["okr_status"]
          superseded_by?: string | null
          tenant_id?: string
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "okr_nodes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "okr_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "okr_nodes_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "okr_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "okr_nodes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "operator" | "admin"
      capability_status: "available" | "planned" | "experimental" | "deprecated"
      okr_creator: "discovery_ai" | "awip" | "human"
      okr_kind: "objective" | "key_result"
      okr_status: "draft" | "active" | "superseded" | "achieved" | "abandoned"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      app_role: ["operator", "admin"],
      capability_status: ["available", "planned", "experimental", "deprecated"],
      okr_creator: ["discovery_ai", "awip", "human"],
      okr_kind: ["objective", "key_result"],
      okr_status: ["draft", "active", "superseded", "achieved", "abandoned"],
    },
  },
} as const
