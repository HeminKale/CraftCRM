export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      // System schema tables
      'system.tenants': {
        Row: {
          id: string
          name: string
          slug: string
          domain: string | null
          settings: Json
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          slug: string
          domain?: string | null
          settings?: Json
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          slug?: string
          domain?: string | null
          settings?: Json
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      'system.users': {
        Row: {
          id: string
          tenant_id: string
          email: string
          first_name: string | null
          last_name: string | null
          role: string
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          tenant_id: string
          email: string
          first_name?: string | null
          last_name?: string | null
          role?: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          email?: string
          first_name?: string | null
          last_name?: string | null
          role?: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      // Tenant schema tables
      'tenant.objects': {
        Row: {
          id: string
          tenant_id: string
          name: string
          label: string
          description: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          name: string
          label: string
          description?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          name?: string
          label?: string
          description?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      'tenant.fields': {
        Row: {
          id: string
          tenant_id: string
          object_id: string
          name: string
          label: string
          type: string
          is_required: boolean
          is_nullable: boolean
          default_value: string | null
          validation_rules: Json | null
          display_order: number
          section: string
          width: number
          is_visible: boolean
          is_system_field: boolean
          reference_table: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          object_id: string
          name: string
          label: string
          type: string
          is_required?: boolean
          is_nullable?: boolean
          default_value?: string | null
          validation_rules?: Json | null
          display_order?: number
          section?: string
          width?: number
          is_visible?: boolean
          is_system_field?: boolean
          reference_table?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          object_id?: string
          name?: string
          label?: string
          type?: string
          is_required?: boolean
          is_nullable?: boolean
          default_value?: string | null
          validation_rules?: Json | null
          display_order?: number
          section?: string
          width?: number
          is_visible?: boolean
          is_system_field?: boolean
          reference_table?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      'tenant.permission_sets': {
        Row: {
          id: string
          tenant_id: string
          name: string
          description: string | null
          api_name: string
          license_type: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          name: string
          description?: string | null
          api_name: string
          license_type?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          name?: string
          description?: string | null
          api_name?: string
          license_type?: string
          created_at?: string
          updated_at?: string
        }
      }
      'tenant.user_permission_sets': {
        Row: {
          id: string
          tenant_id: string
          user_id: string
          perm_set_id: string
          assigned_at: string
          assigned_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          user_id: string
          perm_set_id: string
          assigned_at?: string
          assigned_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          user_id?: string
          perm_set_id?: string
          assigned_at?: string
          assigned_by?: string | null
          created_at?: string
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      'system.jwt_claims': {
        Args: { event: Json }
        Returns: Json
      }
      'tenant.create_object': {
        Args: {
          _object_name: string
          _label: string
          _description?: string
        }
        Returns: string
      }
      'tenant.add_field': {
        Args: {
          _object_id: string
          _field_name: string
          _label: string
          _field_type: string
          _is_required?: boolean
          _default_value?: string
          _validation_rules?: Json
          _section?: string
          _width?: number
          _is_visible?: boolean
        }
        Returns: string
      }
      'tenant.get_objects': {
        Args: Record<PropertyKey, never>
        Returns: {
          id: string
          name: string
          label: string
          description: string | null
          is_active: boolean
          created_at: string
        }[]
      }
      'tenant.get_object_fields': {
        Args: { _object_id: string }
        Returns: {
          id: string
          name: string
          label: string
          type: string
          is_required: boolean
          default_value: string | null
          section: string
          width: number
          is_visible: boolean
          display_order: number
          created_at: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
  }
} 