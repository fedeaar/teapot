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
      fcps: {
        Row: {
          address: string | null
          as_oop: number | null
          building_type: string | null
          city: string | null
          cluster_id: string | null
          cluster_name: string | null
          count_buildings: number | null
          count_homes: number | null
          created_at: string | null
          description: string | null
          district: string | null
          execution_state: string | null
          external_id: string | null
          fcp_name: string
          fill_color: string | null
          id: string
          lat: number | null
          lng: number | null
          planned_cores: number | null
          planned_tu: number | null
          point_geometry: Json | null
          polygon_as_oop: number | null
          polygon_geometry: Json | null
          project_id: string | null
          zip_code: string | null
        }
        Insert: {
          address?: string | null
          as_oop?: number | null
          building_type?: string | null
          city?: string | null
          cluster_id?: string | null
          cluster_name?: string | null
          count_buildings?: number | null
          count_homes?: number | null
          created_at?: string | null
          description?: string | null
          district?: string | null
          execution_state?: string | null
          external_id?: string | null
          fcp_name: string
          fill_color?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          planned_cores?: number | null
          planned_tu?: number | null
          point_geometry?: Json | null
          polygon_as_oop?: number | null
          polygon_geometry?: Json | null
          project_id?: string | null
          zip_code?: string | null
        }
        Update: {
          address?: string | null
          as_oop?: number | null
          building_type?: string | null
          city?: string | null
          cluster_id?: string | null
          cluster_name?: string | null
          count_buildings?: number | null
          count_homes?: number | null
          created_at?: string | null
          description?: string | null
          district?: string | null
          execution_state?: string | null
          external_id?: string | null
          fcp_name?: string
          fill_color?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          planned_cores?: number | null
          planned_tu?: number | null
          point_geometry?: Json | null
          polygon_as_oop?: number | null
          polygon_geometry?: Json | null
          project_id?: string | null
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fcps_cluster_id_fkey"
            columns: ["cluster_id"]
            isOneToOne: false
            referencedRelation: "site_clusters"
            referencedColumns: ["id"]
          },
        ]
      }
      images: {
        Row: {
          ai_override: string | null
          analyzed_at: string | null
          bedding_visible: boolean | null
          captured_at: string | null
          cluster_id: string | null
          compliance_score: number | null
          created_at: string | null
          depth_cm: number | null
          depth_pass: boolean | null
          duct_bundle_visible: boolean | null
          failed_checks: string[] | null
          fcp_id: string | null
          file_size_bytes: number | null
          filename: string
          id: string
          image_height: number | null
          image_url: string
          image_width: number | null
          issues: string[] | null
          latitude: number | null
          longitude: number | null
          passed_checks: string[] | null
          project_id: string | null
          recommendation: string | null
          reviewed_at: string | null
          ruler_visible: boolean | null
          sha256: string
          status: string | null
          trench_id: string | null
          unobstructed: boolean | null
          verdict: string | null
          waypoint_index: number | null
        }
        Insert: {
          ai_override?: string | null
          analyzed_at?: string | null
          bedding_visible?: boolean | null
          captured_at?: string | null
          cluster_id?: string | null
          compliance_score?: number | null
          created_at?: string | null
          depth_cm?: number | null
          depth_pass?: boolean | null
          duct_bundle_visible?: boolean | null
          failed_checks?: string[] | null
          fcp_id?: string | null
          file_size_bytes?: number | null
          filename: string
          id?: string
          image_height?: number | null
          image_url: string
          image_width?: number | null
          issues?: string[] | null
          latitude?: number | null
          longitude?: number | null
          passed_checks?: string[] | null
          project_id?: string | null
          recommendation?: string | null
          reviewed_at?: string | null
          ruler_visible?: boolean | null
          sha256: string
          status?: string | null
          trench_id?: string | null
          unobstructed?: boolean | null
          verdict?: string | null
          waypoint_index?: number | null
        }
        Update: {
          ai_override?: string | null
          analyzed_at?: string | null
          bedding_visible?: boolean | null
          captured_at?: string | null
          cluster_id?: string | null
          compliance_score?: number | null
          created_at?: string | null
          depth_cm?: number | null
          depth_pass?: boolean | null
          duct_bundle_visible?: boolean | null
          failed_checks?: string[] | null
          fcp_id?: string | null
          file_size_bytes?: number | null
          filename?: string
          id?: string
          image_height?: number | null
          image_url?: string
          image_width?: number | null
          issues?: string[] | null
          latitude?: number | null
          longitude?: number | null
          passed_checks?: string[] | null
          project_id?: string | null
          recommendation?: string | null
          reviewed_at?: string | null
          ruler_visible?: boolean | null
          sha256?: string
          status?: string | null
          trench_id?: string | null
          unobstructed?: boolean | null
          verdict?: string | null
          waypoint_index?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "images_cluster_id_fkey"
            columns: ["cluster_id"]
            isOneToOne: false
            referencedRelation: "site_clusters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "images_fcp_id_fkey"
            columns: ["fcp_id"]
            isOneToOne: false
            referencedRelation: "fcps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "images_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "images_trench_id_fkey"
            columns: ["trench_id"]
            isOneToOne: false
            referencedRelation: "trenches"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          created_at: string
          created_by: string
          description: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      site_tokens: {
        Row: {
          code: string
          created_at: string
          created_by: string
          expires_at: string
          id: string
          revoked_at: string | null
          site_id: string
        }
        Insert: {
          code: string
          created_at?: string
          created_by: string
          expires_at: string
          id?: string
          revoked_at?: string | null
          site_id: string
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          revoked_at?: string | null
          site_id?: string
        }
        Relationships: []
      }
      sites: {
        Row: {
          address: string | null
          created_at: string
          created_by: string
          id: string
          latitude: number | null
          longitude: number | null
          name: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          created_by: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          name: string
        }
        Update: {
          address?: string | null
          created_at?: string
          created_by?: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          name?: string
        }
        Relationships: []
      }
      site_clusters: {
        Row: {
          as_oop: number | null
          cluster_name: string
          cluster_type: string | null
          created_at: string | null
          description: string | null
          external_id: string | null
          fill_color: string | null
          geometry: Json | null
          id: string
          lat: number | null
          lng: number | null
          project_id: string | null
        }
        Insert: {
          as_oop?: number | null
          cluster_name: string
          cluster_type?: string | null
          created_at?: string | null
          description?: string | null
          external_id?: string | null
          fill_color?: string | null
          geometry?: Json | null
          id?: string
          lat?: number | null
          lng?: number | null
          project_id?: string | null
        }
        Update: {
          as_oop?: number | null
          cluster_name?: string
          cluster_type?: string | null
          created_at?: string | null
          description?: string | null
          external_id?: string | null
          fill_color?: string | null
          geometry?: Json | null
          id?: string
          lat?: number | null
          lng?: number | null
          project_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "site_clusters_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      trenches: {
        Row: {
          a_end_type: string | null
          a_endpoint: string | null
          as_oop: number | null
          assigned_tu: number | null
          cluster_id: string | null
          created_at: string | null
          duct_contained_size: number | null
          duct_main_full: string | null
          duct_main_short: string | null
          duct_type: string | null
          execution_state: string | null
          execution_state_number: number | null
          external_id: string | null
          fill_color: string | null
          geometry: Json
          gis_uploaded: boolean
          id: string
          is_connected_to_home: boolean | null
          kml_type: string | null
          length_m: number | null
          master_item: string | null
          name: string | null
          project_id: string | null
          z_end_type: string | null
          z_endpoint: string | null
        }
        Insert: {
          a_end_type?: string | null
          a_endpoint?: string | null
          as_oop?: number | null
          assigned_tu?: number | null
          cluster_id?: string | null
          created_at?: string | null
          duct_contained_size?: number | null
          duct_main_full?: string | null
          duct_main_short?: string | null
          duct_type?: string | null
          execution_state?: string | null
          execution_state_number?: number | null
          external_id?: string | null
          fill_color?: string | null
          geometry: Json
          gis_uploaded?: boolean
          id?: string
          is_connected_to_home?: boolean | null
          kml_type?: string | null
          length_m?: number | null
          master_item?: string | null
          name?: string | null
          project_id?: string | null
          z_end_type?: string | null
          z_endpoint?: string | null
        }
        Update: {
          a_end_type?: string | null
          a_endpoint?: string | null
          as_oop?: number | null
          assigned_tu?: number | null
          cluster_id?: string | null
          created_at?: string | null
          duct_contained_size?: number | null
          duct_main_full?: string | null
          duct_main_short?: string | null
          duct_type?: string | null
          execution_state?: string | null
          execution_state_number?: number | null
          external_id?: string | null
          fill_color?: string | null
          geometry?: Json
          gis_uploaded?: boolean
          id?: string
          is_connected_to_home?: boolean | null
          kml_type?: string | null
          length_m?: number | null
          master_item?: string | null
          name?: string | null
          project_id?: string | null
          z_end_type?: string | null
          z_endpoint?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trenches_cluster_id_fkey"
            columns: ["cluster_id"]
            isOneToOne: false
            referencedRelation: "site_clusters"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      redeem_site_token: {
        Args: {
          _code: string
        }
        Returns: {
          site_id: string
          site_name: string
          site_address: string | null
          site_lat: number | null
          site_lng: number | null
          expires_at: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
