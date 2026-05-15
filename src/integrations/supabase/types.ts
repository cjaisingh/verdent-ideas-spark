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
      activity_policies: {
        Row: {
          activity: string
          conditions: Json
          default_action: string
          id: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          activity: string
          conditions?: Json
          default_action?: string
          id?: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          activity?: string
          conditions?: Json
          default_action?: string
          id?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      agent_onboarding_sessions: {
        Row: {
          activity: string | null
          actor: string
          agent_slug: string
          approval_id: string | null
          capability_id: string | null
          checklist: Json
          completed_at: string | null
          created_at: string
          goal_text: string | null
          id: string
          intent: string
          notes: string | null
          required_approvals: string[]
          required_capabilities: string[]
          risk: string
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          activity?: string | null
          actor: string
          agent_slug: string
          approval_id?: string | null
          capability_id?: string | null
          checklist?: Json
          completed_at?: string | null
          created_at?: string
          goal_text?: string | null
          id?: string
          intent: string
          notes?: string | null
          required_approvals?: string[]
          required_capabilities?: string[]
          risk?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          activity?: string | null
          actor?: string
          agent_slug?: string
          approval_id?: string | null
          capability_id?: string | null
          checklist?: Json
          completed_at?: string | null
          created_at?: string
          goal_text?: string | null
          id?: string
          intent?: string
          notes?: string | null
          required_approvals?: string[]
          required_capabilities?: string[]
          risk?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      ai_usage_log: {
        Row: {
          completion_tokens: number | null
          cost_usd: number | null
          created_at: string
          error: string | null
          id: string
          job: string
          latency_ms: number | null
          model: string
          price_in_per_mtok: number | null
          price_out_per_mtok: number | null
          prompt_tokens: number | null
          request_ref: Json
          status: string
          status_code: number | null
          total_tokens: number | null
          trigger: string
        }
        Insert: {
          completion_tokens?: number | null
          cost_usd?: number | null
          created_at?: string
          error?: string | null
          id?: string
          job: string
          latency_ms?: number | null
          model: string
          price_in_per_mtok?: number | null
          price_out_per_mtok?: number | null
          prompt_tokens?: number | null
          request_ref?: Json
          status?: string
          status_code?: number | null
          total_tokens?: number | null
          trigger?: string
        }
        Update: {
          completion_tokens?: number | null
          cost_usd?: number | null
          created_at?: string
          error?: string | null
          id?: string
          job?: string
          latency_ms?: number | null
          model?: string
          price_in_per_mtok?: number | null
          price_out_per_mtok?: number | null
          prompt_tokens?: number | null
          request_ref?: Json
          status?: string
          status_code?: number | null
          total_tokens?: number | null
          trigger?: string
        }
        Relationships: []
      }
      alert_cost_thresholds: {
        Row: {
          alert_on_cost: boolean
          cost_per_day_usd: number | null
          cost_per_run_usd: number | null
          created_at: string
          job: string
          updated_at: string
        }
        Insert: {
          alert_on_cost?: boolean
          cost_per_day_usd?: number | null
          cost_per_run_usd?: number | null
          created_at?: string
          job: string
          updated_at?: string
        }
        Update: {
          alert_on_cost?: boolean
          cost_per_day_usd?: number | null
          cost_per_run_usd?: number | null
          created_at?: string
          job?: string
          updated_at?: string
        }
        Relationships: []
      }
      alert_log: {
        Row: {
          created_at: string
          delivered: boolean
          error: string | null
          id: string
          job: string
          message: string | null
          payload: Json
          reason: string
          status_code: number | null
        }
        Insert: {
          created_at?: string
          delivered?: boolean
          error?: string | null
          id?: string
          job: string
          message?: string | null
          payload?: Json
          reason: string
          status_code?: number | null
        }
        Update: {
          created_at?: string
          delivered?: boolean
          error?: string | null
          id?: string
          job?: string
          message?: string | null
          payload?: Json
          reason?: string
          status_code?: number | null
        }
        Relationships: []
      }
      alert_settings: {
        Row: {
          alert_on_auth_failed: boolean
          alert_on_cost: boolean
          alert_on_high_finding: boolean
          alert_on_qa_fail: boolean
          alert_on_review_error: boolean
          alert_on_test_fail: boolean
          auth_failed_threshold: number
          auth_failed_window_minutes: number
          cost_per_day_usd: number | null
          cost_per_run_usd: number | null
          dedupe_minutes: number
          enabled: boolean
          id: boolean
          updated_at: string
          webhook_url: string | null
        }
        Insert: {
          alert_on_auth_failed?: boolean
          alert_on_cost?: boolean
          alert_on_high_finding?: boolean
          alert_on_qa_fail?: boolean
          alert_on_review_error?: boolean
          alert_on_test_fail?: boolean
          auth_failed_threshold?: number
          auth_failed_window_minutes?: number
          cost_per_day_usd?: number | null
          cost_per_run_usd?: number | null
          dedupe_minutes?: number
          enabled?: boolean
          id?: boolean
          updated_at?: string
          webhook_url?: string | null
        }
        Update: {
          alert_on_auth_failed?: boolean
          alert_on_cost?: boolean
          alert_on_high_finding?: boolean
          alert_on_qa_fail?: boolean
          alert_on_review_error?: boolean
          alert_on_test_fail?: boolean
          auth_failed_threshold?: number
          auth_failed_window_minutes?: number
          cost_per_day_usd?: number | null
          cost_per_run_usd?: number | null
          dedupe_minutes?: number
          enabled?: boolean
          id?: boolean
          updated_at?: string
          webhook_url?: string | null
        }
        Relationships: []
      }
      analytics_daily_ai_usage: {
        Row: {
          calls: number
          completion_tokens: number
          computed_at: string
          cost_usd: number
          created_at: string
          errors: number
          id: string
          job: string
          model: string
          p50_latency_ms: number | null
          p95_latency_ms: number | null
          prompt_tokens: number
          rollup_date: string
        }
        Insert: {
          calls?: number
          completion_tokens?: number
          computed_at?: string
          cost_usd?: number
          created_at?: string
          errors?: number
          id?: string
          job: string
          model: string
          p50_latency_ms?: number | null
          p95_latency_ms?: number | null
          prompt_tokens?: number
          rollup_date: string
        }
        Update: {
          calls?: number
          completion_tokens?: number
          computed_at?: string
          cost_usd?: number
          created_at?: string
          errors?: number
          id?: string
          job?: string
          model?: string
          p50_latency_ms?: number | null
          p95_latency_ms?: number | null
          prompt_tokens?: number
          rollup_date?: string
        }
        Relationships: []
      }
      analytics_daily_automation: {
        Row: {
          avg_duration_ms: number | null
          computed_at: string
          created_at: string
          error_rate: number
          errors: number
          id: string
          job: string
          p95_duration_ms: number | null
          rollup_date: string
          runs: number
        }
        Insert: {
          avg_duration_ms?: number | null
          computed_at?: string
          created_at?: string
          error_rate?: number
          errors?: number
          id?: string
          job: string
          p95_duration_ms?: number | null
          rollup_date: string
          runs?: number
        }
        Update: {
          avg_duration_ms?: number | null
          computed_at?: string
          created_at?: string
          error_rate?: number
          errors?: number
          id?: string
          job?: string
          p95_duration_ms?: number | null
          rollup_date?: string
          runs?: number
        }
        Relationships: []
      }
      analytics_daily_cost: {
        Row: {
          ai_calls: number
          ai_cost_usd: number
          ai_errors: number
          computed_at: string
          created_at: string
          rollup_date: string
          top_job: string | null
          top_job_cost_usd: number | null
        }
        Insert: {
          ai_calls?: number
          ai_cost_usd?: number
          ai_errors?: number
          computed_at?: string
          created_at?: string
          rollup_date: string
          top_job?: string | null
          top_job_cost_usd?: number | null
        }
        Update: {
          ai_calls?: number
          ai_cost_usd?: number
          ai_errors?: number
          computed_at?: string
          created_at?: string
          rollup_date?: string
          top_job?: string | null
          top_job_cost_usd?: number | null
        }
        Relationships: []
      }
      api_call_logs: {
        Row: {
          actor: string | null
          created_at: string
          duration_ms: number | null
          error: string | null
          id: string
          idempotency_key: string | null
          idempotent_replay: boolean
          method: string
          request_summary: Json
          response_summary: Json
          route: string
          status_code: number
          tenant_id: string | null
        }
        Insert: {
          actor?: string | null
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          idempotency_key?: string | null
          idempotent_replay?: boolean
          method: string
          request_summary?: Json
          response_summary?: Json
          route: string
          status_code: number
          tenant_id?: string | null
        }
        Update: {
          actor?: string | null
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          idempotency_key?: string | null
          idempotent_replay?: boolean
          method?: string
          request_summary?: Json
          response_summary?: Json
          route?: string
          status_code?: number
          tenant_id?: string | null
        }
        Relationships: []
      }
      app_secrets: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          updated_by: string | null
          value: string
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          updated_by?: string | null
          value: string
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: string
        }
        Relationships: []
      }
      approval_queue: {
        Row: {
          activity: string
          callback_url: string | null
          capability_id: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          idempotency_key: string | null
          intent_payload: Json
          requested_by: string | null
          requesting_module: string | null
          result: Json | null
          risk: string
          status: string
          telegram_message_id: number | null
          tenant_id: string | null
        }
        Insert: {
          activity: string
          callback_url?: string | null
          capability_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          idempotency_key?: string | null
          intent_payload?: Json
          requested_by?: string | null
          requesting_module?: string | null
          result?: Json | null
          risk?: string
          status?: string
          telegram_message_id?: number | null
          tenant_id?: string | null
        }
        Update: {
          activity?: string
          callback_url?: string | null
          capability_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          idempotency_key?: string | null
          intent_payload?: Json
          requested_by?: string | null
          requesting_module?: string | null
          result?: Json | null
          risk?: string
          status?: string
          telegram_message_id?: number | null
          tenant_id?: string | null
        }
        Relationships: []
      }
      automation_runs: {
        Row: {
          created_at: string
          detail: Json
          duration_ms: number | null
          id: string
          job: string
          message: string | null
          status: string
          status_code: number | null
          trigger: string
        }
        Insert: {
          created_at?: string
          detail?: Json
          duration_ms?: number | null
          id?: string
          job: string
          message?: string | null
          status: string
          status_code?: number | null
          trigger?: string
        }
        Update: {
          created_at?: string
          detail?: Json
          duration_ms?: number | null
          id?: string
          job?: string
          message?: string | null
          status?: string
          status_code?: number | null
          trigger?: string
        }
        Relationships: []
      }
      awip_doc_chunks: {
        Row: {
          content: string
          created_at: string
          doc_id: string
          heading: string | null
          id: string
          ord: number
          tsv: unknown
        }
        Insert: {
          content: string
          created_at?: string
          doc_id: string
          heading?: string | null
          id?: string
          ord?: number
          tsv?: unknown
        }
        Update: {
          content?: string
          created_at?: string
          doc_id?: string
          heading?: string | null
          id?: string
          ord?: number
          tsv?: unknown
        }
        Relationships: [
          {
            foreignKeyName: "awip_doc_chunks_doc_id_fkey"
            columns: ["doc_id"]
            isOneToOne: false
            referencedRelation: "awip_docs"
            referencedColumns: ["id"]
          },
        ]
      }
      awip_docs: {
        Row: {
          created_at: string
          id: string
          path: string
          sha: string | null
          source: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          path: string
          sha?: string | null
          source?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          path?: string
          sha?: string | null
          source?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      awip_review_findings: {
        Row: {
          actionable: boolean
          area: string | null
          created_at: string
          discussion_action_id: string | null
          evidence: string | null
          ext_id: string | null
          id: string
          rag_doc_id: string | null
          recommendation: string | null
          review_id: string
          sentinel_finding_id: string | null
          severity: string
          title: string
        }
        Insert: {
          actionable?: boolean
          area?: string | null
          created_at?: string
          discussion_action_id?: string | null
          evidence?: string | null
          ext_id?: string | null
          id?: string
          rag_doc_id?: string | null
          recommendation?: string | null
          review_id: string
          sentinel_finding_id?: string | null
          severity?: string
          title: string
        }
        Update: {
          actionable?: boolean
          area?: string | null
          created_at?: string
          discussion_action_id?: string | null
          evidence?: string | null
          ext_id?: string | null
          id?: string
          rag_doc_id?: string | null
          recommendation?: string | null
          review_id?: string
          sentinel_finding_id?: string | null
          severity?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "awip_review_findings_discussion_action_id_fkey"
            columns: ["discussion_action_id"]
            isOneToOne: false
            referencedRelation: "discussion_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "awip_review_findings_discussion_action_id_fkey"
            columns: ["discussion_action_id"]
            isOneToOne: false
            referencedRelation: "discussion_actions_stuck_in_night"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "awip_review_findings_rag_doc_id_fkey"
            columns: ["rag_doc_id"]
            isOneToOne: false
            referencedRelation: "awip_docs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "awip_review_findings_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "awip_reviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "awip_review_findings_sentinel_finding_id_fkey"
            columns: ["sentinel_finding_id"]
            isOneToOne: false
            referencedRelation: "sentinel_findings"
            referencedColumns: ["id"]
          },
        ]
      }
      awip_reviews: {
        Row: {
          created_at: string
          fetched_at: string
          file_sha: string
          id: string
          parsed: Json
          process_error: string | null
          process_status: string
          processed_at: string | null
          raw_markdown: string
          review_date: string | null
          reviewer: string | null
          scope: string | null
          source_path: string
          source_repo: string
          summary: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          fetched_at?: string
          file_sha: string
          id?: string
          parsed?: Json
          process_error?: string | null
          process_status?: string
          processed_at?: string | null
          raw_markdown: string
          review_date?: string | null
          reviewer?: string | null
          scope?: string | null
          source_path: string
          source_repo: string
          summary?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          fetched_at?: string
          file_sha?: string
          id?: string
          parsed?: Json
          process_error?: string | null
          process_status?: string
          processed_at?: string | null
          raw_markdown?: string
          review_date?: string | null
          reviewer?: string | null
          scope?: string | null
          source_path?: string
          source_repo?: string
          summary?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      cache_warm_runs: {
        Row: {
          created_at: string
          duration_ms: number | null
          error: string | null
          id: string
          ok: boolean
          route: string
          started_at: string
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          ok?: boolean
          route: string
          started_at?: string
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          ok?: boolean
          route?: string
          started_at?: string
        }
        Relationships: []
      }
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
          verify: Json | null
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
          verify?: Json | null
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
          verify?: Json | null
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
      claim_events: {
        Row: {
          actor: string | null
          actor_label: string | null
          claim_id: string | null
          created_at: string
          entity: string
          entity_id: string
          event_type: string
          field: string
          id: string
          payload: Json
          source: string
        }
        Insert: {
          actor?: string | null
          actor_label?: string | null
          claim_id?: string | null
          created_at?: string
          entity: string
          entity_id: string
          event_type: string
          field: string
          id?: string
          payload?: Json
          source: string
        }
        Update: {
          actor?: string | null
          actor_label?: string | null
          claim_id?: string | null
          created_at?: string
          entity?: string
          entity_id?: string
          event_type?: string
          field?: string
          id?: string
          payload?: Json
          source?: string
        }
        Relationships: []
      }
      claims: {
        Row: {
          claimed_by: string | null
          claimed_by_label: string | null
          confidence: number
          created_at: string
          entity: string
          entity_id: string
          evidence_ref: Json
          field: string
          id: string
          note: string | null
          source: string
          supersedes_id: string | null
          valid_from: string
          valid_to: string | null
          value: Json
          voided_at: string | null
          voided_reason: string | null
        }
        Insert: {
          claimed_by?: string | null
          claimed_by_label?: string | null
          confidence?: number
          created_at?: string
          entity: string
          entity_id: string
          evidence_ref?: Json
          field?: string
          id?: string
          note?: string | null
          source: string
          supersedes_id?: string | null
          valid_from?: string
          valid_to?: string | null
          value: Json
          voided_at?: string | null
          voided_reason?: string | null
        }
        Update: {
          claimed_by?: string | null
          claimed_by_label?: string | null
          confidence?: number
          created_at?: string
          entity?: string
          entity_id?: string
          evidence_ref?: Json
          field?: string
          id?: string
          note?: string | null
          source?: string
          supersedes_id?: string | null
          valid_from?: string
          valid_to?: string | null
          value?: Json
          voided_at?: string | null
          voided_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "claims_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
        ]
      }
      client_error_log: {
        Row: {
          created_at: string
          function_name: string | null
          id: string
          message: string
          meta: Json
          request_id: string | null
          url: string | null
          user_agent: string | null
          user_id_hash: string | null
        }
        Insert: {
          created_at?: string
          function_name?: string | null
          id?: string
          message: string
          meta?: Json
          request_id?: string | null
          url?: string | null
          user_agent?: string | null
          user_id_hash?: string | null
        }
        Update: {
          created_at?: string
          function_name?: string | null
          id?: string
          message?: string
          meta?: Json
          request_id?: string | null
          url?: string | null
          user_agent?: string | null
          user_id_hash?: string | null
        }
        Relationships: []
      }
      companion_messages: {
        Row: {
          content: string
          created_at: string
          escalated_action_id: string | null
          id: string
          latency_ms: number | null
          model: string | null
          parts: Json
          rag_chunk_ids: Json
          role: string
          status: string
          streamed_at: string | null
          thread_id: string
        }
        Insert: {
          content?: string
          created_at?: string
          escalated_action_id?: string | null
          id?: string
          latency_ms?: number | null
          model?: string | null
          parts?: Json
          rag_chunk_ids?: Json
          role: string
          status?: string
          streamed_at?: string | null
          thread_id: string
        }
        Update: {
          content?: string
          created_at?: string
          escalated_action_id?: string | null
          id?: string
          latency_ms?: number | null
          model?: string | null
          parts?: Json
          rag_chunk_ids?: Json
          role?: string
          status?: string
          streamed_at?: string | null
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "companion_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "companion_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      companion_session_state: {
        Row: {
          last_seen_at: string
          last_thread_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          last_seen_at?: string
          last_thread_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          last_seen_at?: string
          last_thread_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "companion_session_state_last_thread_id_fkey"
            columns: ["last_thread_id"]
            isOneToOne: false
            referencedRelation: "companion_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      companion_threads: {
        Row: {
          agent_kind: string
          archived_at: string | null
          created_at: string
          created_by: string
          id: string
          model: string | null
          ollama_base_url: string | null
          seed_payload: Json
          title: string
          updated_at: string
        }
        Insert: {
          agent_kind?: string
          archived_at?: string | null
          created_at?: string
          created_by: string
          id?: string
          model?: string | null
          ollama_base_url?: string | null
          seed_payload?: Json
          title?: string
          updated_at?: string
        }
        Update: {
          agent_kind?: string
          archived_at?: string | null
          created_at?: string
          created_by?: string
          id?: string
          model?: string | null
          ollama_base_url?: string | null
          seed_payload?: Json
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      connection_audit_log: {
        Row: {
          action: string
          actor_user_id: string
          connector_id: string
          created_at: string
          env_var_name: string
          id: string
          note: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string
          connector_id: string
          created_at?: string
          env_var_name: string
          id?: string
          note?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string
          connector_id?: string
          created_at?: string
          env_var_name?: string
          id?: string
          note?: string | null
        }
        Relationships: []
      }
      connection_test_results: {
        Row: {
          connector_id: string
          env_var_name: string
          error: string | null
          latency_ms: number | null
          outcome: string
          scope_hint: Json | null
          tested_at: string
          tested_by: string | null
        }
        Insert: {
          connector_id: string
          env_var_name: string
          error?: string | null
          latency_ms?: number | null
          outcome: string
          scope_hint?: Json | null
          tested_at?: string
          tested_by?: string | null
        }
        Update: {
          connector_id?: string
          env_var_name?: string
          error?: string | null
          latency_ms?: number | null
          outcome?: string
          scope_hint?: Json | null
          tested_at?: string
          tested_by?: string | null
        }
        Relationships: []
      }
      copilot_agent_overrides: {
        Row: {
          agent_id: string
          created_at: string
          enabled: boolean
          greeting: string | null
          id: string
          mic_gain: number | null
          noise_gate: number | null
          out_volume: number | null
          tts_voice: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          enabled?: boolean
          greeting?: string | null
          id?: string
          mic_gain?: number | null
          noise_gate?: number | null
          out_volume?: number | null
          tts_voice?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          enabled?: boolean
          greeting?: string | null
          id?: string
          mic_gain?: number | null
          noise_gate?: number | null
          out_volume?: number | null
          tts_voice?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "copilot_agent_overrides_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "copilot_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_agents: {
        Row: {
          allowed_capability_ids: string[]
          allowed_tables: string[]
          created_at: string
          default_greeting: string
          description: string | null
          enabled: boolean
          id: string
          language: string
          max_risk: string
          name: string
          order: number
          slug: string
          system_prompt: string
          tts_voice: string
          updated_at: string
          wake_word: string
        }
        Insert: {
          allowed_capability_ids?: string[]
          allowed_tables?: string[]
          created_at?: string
          default_greeting?: string
          description?: string | null
          enabled?: boolean
          id?: string
          language?: string
          max_risk?: string
          name: string
          order?: number
          slug: string
          system_prompt?: string
          tts_voice?: string
          updated_at?: string
          wake_word: string
        }
        Update: {
          allowed_capability_ids?: string[]
          allowed_tables?: string[]
          created_at?: string
          default_greeting?: string
          description?: string | null
          enabled?: boolean
          id?: string
          language?: string
          max_risk?: string
          name?: string
          order?: number
          slug?: string
          system_prompt?: string
          tts_voice?: string
          updated_at?: string
          wake_word?: string
        }
        Relationships: []
      }
      copilot_lessons: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          lesson: string
          scope: string
          source: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          lesson: string
          scope?: string
          source?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          lesson?: string
          scope?: string
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      copilot_profiles: {
        Row: {
          context_notes: string | null
          created_at: string
          default_agent_id: string | null
          display_name: string | null
          language: string
          narrowed_capability_ids: string[]
          narrowed_max_risk: string
          narrowed_tables: string[]
          pronouns: string | null
          timezone: string
          title: string | null
          updated_at: string
          user_id: string
          verbosity: string
        }
        Insert: {
          context_notes?: string | null
          created_at?: string
          default_agent_id?: string | null
          display_name?: string | null
          language?: string
          narrowed_capability_ids?: string[]
          narrowed_max_risk?: string
          narrowed_tables?: string[]
          pronouns?: string | null
          timezone?: string
          title?: string | null
          updated_at?: string
          user_id: string
          verbosity?: string
        }
        Update: {
          context_notes?: string | null
          created_at?: string
          default_agent_id?: string | null
          display_name?: string | null
          language?: string
          narrowed_capability_ids?: string[]
          narrowed_max_risk?: string
          narrowed_tables?: string[]
          pronouns?: string | null
          timezone?: string
          title?: string | null
          updated_at?: string
          user_id?: string
          verbosity?: string
        }
        Relationships: [
          {
            foreignKeyName: "copilot_profiles_default_agent_id_fkey"
            columns: ["default_agent_id"]
            isOneToOne: false
            referencedRelation: "copilot_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_settings: {
        Row: {
          active_agent_id: string | null
          created_at: string
          greeting: string
          language: string
          mic_gain: number
          model: string
          noise_gate: number
          out_volume: number
          ptt_mode: boolean
          stt_model: string
          tts_voice: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active_agent_id?: string | null
          created_at?: string
          greeting?: string
          language?: string
          mic_gain?: number
          model?: string
          noise_gate?: number
          out_volume?: number
          ptt_mode?: boolean
          stt_model?: string
          tts_voice?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active_agent_id?: string | null
          created_at?: string
          greeting?: string
          language?: string
          mic_gain?: number
          model?: string
          noise_gate?: number
          out_volume?: number
          ptt_mode?: boolean
          stt_model?: string
          tts_voice?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "copilot_settings_active_agent_id_fkey"
            columns: ["active_agent_id"]
            isOneToOne: false
            referencedRelation: "copilot_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_transcript_turns: {
        Row: {
          content: string
          created_at: string
          id: string
          latency_ms: number | null
          model: string | null
          ord: number
          role: string
          tool_calls: Json | null
          transcript_id: string
        }
        Insert: {
          content?: string
          created_at?: string
          id?: string
          latency_ms?: number | null
          model?: string | null
          ord: number
          role: string
          tool_calls?: Json | null
          transcript_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          latency_ms?: number | null
          model?: string | null
          ord?: number
          role?: string
          tool_calls?: Json | null
          transcript_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "copilot_transcript_turns_transcript_id_fkey"
            columns: ["transcript_id"]
            isOneToOne: false
            referencedRelation: "copilot_transcripts"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_transcripts: {
        Row: {
          agent_slug: string | null
          analysis: Json | null
          analyzed_at: string | null
          created_at: string
          ended_at: string | null
          id: string
          model: string | null
          started_at: string
          summary: string | null
          turn_count: number
          user_id: string | null
        }
        Insert: {
          agent_slug?: string | null
          analysis?: Json | null
          analyzed_at?: string | null
          created_at?: string
          ended_at?: string | null
          id?: string
          model?: string | null
          started_at?: string
          summary?: string | null
          turn_count?: number
          user_id?: string | null
        }
        Update: {
          agent_slug?: string | null
          analysis?: Json | null
          analyzed_at?: string | null
          created_at?: string
          ended_at?: string | null
          id?: string
          model?: string | null
          started_at?: string
          summary?: string | null
          turn_count?: number
          user_id?: string | null
        }
        Relationships: []
      }
      cost_estimates: {
        Row: {
          created_at: string
          created_by: string | null
          estimated_usd: number
          id: string
          job: string | null
          kind: string
          model: string | null
          notes: string | null
          task_id: string | null
          updated_at: string
          workstream_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          estimated_usd: number
          id?: string
          job?: string | null
          kind: string
          model?: string | null
          notes?: string | null
          task_id?: string | null
          updated_at?: string
          workstream_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          estimated_usd?: number
          id?: string
          job?: string | null
          kind?: string
          model?: string | null
          notes?: string | null
          task_id?: string | null
          updated_at?: string
          workstream_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cost_estimates_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "plan_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_estimates_workstream_id_fkey"
            columns: ["workstream_id"]
            isOneToOne: false
            referencedRelation: "cost_summary_by_workstream"
            referencedColumns: ["workstream_id"]
          },
          {
            foreignKeyName: "cost_estimates_workstream_id_fkey"
            columns: ["workstream_id"]
            isOneToOne: false
            referencedRelation: "plan_workstreams"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_plans: {
        Row: {
          created_at: string
          focus: string | null
          for_date: string
          generated_at: string
          id: string
          inputs_summary: Json
          model: string
          plan_md: string
          recommendations: Json
          risks: Json
        }
        Insert: {
          created_at?: string
          focus?: string | null
          for_date: string
          generated_at?: string
          id?: string
          inputs_summary?: Json
          model: string
          plan_md: string
          recommendations?: Json
          risks?: Json
        }
        Update: {
          created_at?: string
          focus?: string | null
          for_date?: string
          generated_at?: string
          id?: string
          inputs_summary?: Json
          model?: string
          plan_md?: string
          recommendations?: Json
          risks?: Json
        }
        Relationships: []
      }
      daily_snapshots: {
        Row: {
          ai_brief: string | null
          ai_cost_usd: number | null
          ai_model: string | null
          created_at: string
          generated_at: string
          id: string
          kind: string
          payload: Json
          snapshot_date: string
          summary: string | null
        }
        Insert: {
          ai_brief?: string | null
          ai_cost_usd?: number | null
          ai_model?: string | null
          created_at?: string
          generated_at?: string
          id?: string
          kind: string
          payload?: Json
          snapshot_date: string
          summary?: string | null
        }
        Update: {
          ai_brief?: string | null
          ai_cost_usd?: number | null
          ai_model?: string | null
          created_at?: string
          generated_at?: string
          id?: string
          kind?: string
          payload?: Json
          snapshot_date?: string
          summary?: string | null
        }
        Relationships: []
      }
      db_explorer_audit: {
        Row: {
          action: string | null
          created_at: string
          duration_ms: number | null
          error_code: string | null
          id: string
          limit: number | null
          offset: number | null
          rejected: boolean
          rejection_reason: string | null
          request_id: string
          requested: Json | null
          result_count: number | null
          status: number
          table: string | null
          user_id: string | null
        }
        Insert: {
          action?: string | null
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          id?: string
          limit?: number | null
          offset?: number | null
          rejected?: boolean
          rejection_reason?: string | null
          request_id: string
          requested?: Json | null
          result_count?: number | null
          status: number
          table?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string | null
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          id?: string
          limit?: number | null
          offset?: number | null
          rejected?: boolean
          rejection_reason?: string | null
          request_id?: string
          requested?: Json | null
          result_count?: number | null
          status?: number
          table?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      decision_authorities: {
        Row: {
          created_at: string
          entity: string
          field: string
          id: string
          notes: string | null
          override_policy: string
          precedence: number
          source: string
          updated_at: string
          weight: number
        }
        Insert: {
          created_at?: string
          entity: string
          field?: string
          id?: string
          notes?: string | null
          override_policy?: string
          precedence: number
          source: string
          updated_at?: string
          weight?: number
        }
        Update: {
          created_at?: string
          entity?: string
          field?: string
          id?: string
          notes?: string | null
          override_policy?: string
          precedence?: number
          source?: string
          updated_at?: string
          weight?: number
        }
        Relationships: []
      }
      decision_authority_events: {
        Row: {
          actor: string | null
          actor_label: string | null
          created_at: string
          entity: string
          event_type: string
          field: string
          id: string
          payload: Json
          rule_id: string | null
          source: string
        }
        Insert: {
          actor?: string | null
          actor_label?: string | null
          created_at?: string
          entity: string
          event_type: string
          field: string
          id?: string
          payload?: Json
          rule_id?: string | null
          source: string
        }
        Update: {
          actor?: string | null
          actor_label?: string | null
          created_at?: string
          entity?: string
          event_type?: string
          field?: string
          id?: string
          payload?: Json
          rule_id?: string | null
          source?: string
        }
        Relationships: []
      }
      deep_audit_runs: {
        Row: {
          cadence: string
          created_at: string
          findings: Json
          finished_at: string | null
          id: string
          modules: Json
          started_at: string
          status: string
          summary: Json
          triggered_by: string
        }
        Insert: {
          cadence: string
          created_at?: string
          findings?: Json
          finished_at?: string | null
          id?: string
          modules?: Json
          started_at?: string
          status?: string
          summary?: Json
          triggered_by?: string
        }
        Update: {
          cadence?: string
          created_at?: string
          findings?: Json
          finished_at?: string | null
          id?: string
          modules?: Json
          started_at?: string
          status?: string
          summary?: Json
          triggered_by?: string
        }
        Relationships: []
      }
      deferred_items: {
        Row: {
          created_at: string
          defer_until: string
          id: string
          originating_context: Json
          reason: string
          resolved_at: string | null
          resolved_by: string | null
          revisited_at: string | null
          severity: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          defer_until?: string
          id?: string
          originating_context?: Json
          reason: string
          resolved_at?: string | null
          resolved_by?: string | null
          revisited_at?: string | null
          severity?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          defer_until?: string
          id?: string
          originating_context?: Json
          reason?: string
          resolved_at?: string | null
          resolved_by?: string | null
          revisited_at?: string | null
          severity?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      discussion_action_events: {
        Row: {
          action_id: string | null
          actor: string | null
          actor_label: string | null
          created_at: string
          discussion_id: string | null
          event_type: string
          id: string
          payload: Json
        }
        Insert: {
          action_id?: string | null
          actor?: string | null
          actor_label?: string | null
          created_at?: string
          discussion_id?: string | null
          event_type: string
          id?: string
          payload?: Json
        }
        Update: {
          action_id?: string | null
          actor?: string | null
          actor_label?: string | null
          created_at?: string
          discussion_id?: string | null
          event_type?: string
          id?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "discussion_action_events_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "discussion_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discussion_action_events_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "discussion_actions_stuck_in_night"
            referencedColumns: ["id"]
          },
        ]
      }
      discussion_action_findings: {
        Row: {
          action_id: string
          created_at: string
          finding_id: string
          id: string
          linked_by: string | null
          linked_by_label: string | null
          note: string | null
        }
        Insert: {
          action_id: string
          created_at?: string
          finding_id: string
          id?: string
          linked_by?: string | null
          linked_by_label?: string | null
          note?: string | null
        }
        Update: {
          action_id?: string
          created_at?: string
          finding_id?: string
          id?: string
          linked_by?: string | null
          linked_by_label?: string | null
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "discussion_action_findings_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "discussion_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discussion_action_findings_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "discussion_actions_stuck_in_night"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discussion_action_findings_finding_id_fkey"
            columns: ["finding_id"]
            isOneToOne: false
            referencedRelation: "sentinel_findings"
            referencedColumns: ["id"]
          },
        ]
      }
      discussion_actions: {
        Row: {
          ci_branch: string | null
          ci_close_on_success: boolean
          ci_last_checked_at: string | null
          ci_last_conclusion: string | null
          ci_last_run_id: number | null
          ci_last_run_sha: string | null
          ci_last_run_url: string | null
          ci_last_status: string | null
          ci_workflow_file: string | null
          created_at: string
          created_by: string | null
          details: string | null
          discussion_id: string | null
          due_at: string | null
          extracted_confidence: number | null
          id: string
          morning_review_panel_ref: string | null
          night_eligible: boolean
          night_override_reason: string | null
          owner: string | null
          priority: string
          promoted_task_id: string | null
          risk: string
          short_num: number
          source: string
          status: string
          subject_id: string
          subject_type: string
          title: string
          updated_at: string
        }
        Insert: {
          ci_branch?: string | null
          ci_close_on_success?: boolean
          ci_last_checked_at?: string | null
          ci_last_conclusion?: string | null
          ci_last_run_id?: number | null
          ci_last_run_sha?: string | null
          ci_last_run_url?: string | null
          ci_last_status?: string | null
          ci_workflow_file?: string | null
          created_at?: string
          created_by?: string | null
          details?: string | null
          discussion_id?: string | null
          due_at?: string | null
          extracted_confidence?: number | null
          id?: string
          morning_review_panel_ref?: string | null
          night_eligible?: boolean
          night_override_reason?: string | null
          owner?: string | null
          priority?: string
          promoted_task_id?: string | null
          risk?: string
          short_num?: number
          source?: string
          status?: string
          subject_id: string
          subject_type: string
          title: string
          updated_at?: string
        }
        Update: {
          ci_branch?: string | null
          ci_close_on_success?: boolean
          ci_last_checked_at?: string | null
          ci_last_conclusion?: string | null
          ci_last_run_id?: number | null
          ci_last_run_sha?: string | null
          ci_last_run_url?: string | null
          ci_last_status?: string | null
          ci_workflow_file?: string | null
          created_at?: string
          created_by?: string | null
          details?: string | null
          discussion_id?: string | null
          due_at?: string | null
          extracted_confidence?: number | null
          id?: string
          morning_review_panel_ref?: string | null
          night_eligible?: boolean
          night_override_reason?: string | null
          owner?: string | null
          priority?: string
          promoted_task_id?: string | null
          risk?: string
          short_num?: number
          source?: string
          status?: string
          subject_id?: string
          subject_type?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "discussion_actions_discussion_id_fkey"
            columns: ["discussion_id"]
            isOneToOne: false
            referencedRelation: "roadmap_finding_discussions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discussion_actions_promoted_task_id_fkey"
            columns: ["promoted_task_id"]
            isOneToOne: false
            referencedRelation: "roadmap_task_outcome_health"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "discussion_actions_promoted_task_id_fkey"
            columns: ["promoted_task_id"]
            isOneToOne: false
            referencedRelation: "roadmap_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      edge_request_logs: {
        Row: {
          classified_error: string | null
          created_at: string
          error_message: string | null
          function_name: string
          id: string
          latency_ms: number | null
          meta: Json
          method: string | null
          path: string | null
          request_id: string
          status: number | null
          user_id_hash: string | null
        }
        Insert: {
          classified_error?: string | null
          created_at?: string
          error_message?: string | null
          function_name: string
          id?: string
          latency_ms?: number | null
          meta?: Json
          method?: string | null
          path?: string | null
          request_id: string
          status?: number | null
          user_id_hash?: string | null
        }
        Update: {
          classified_error?: string | null
          created_at?: string
          error_message?: string | null
          function_name?: string
          id?: string
          latency_ms?: number | null
          meta?: Json
          method?: string | null
          path?: string | null
          request_id?: string
          status?: number | null
          user_id_hash?: string | null
        }
        Relationships: []
      }
      frontend_error_logs: {
        Row: {
          colno: number | null
          created_at: string
          id: string
          kind: string
          lineno: number | null
          message: string
          meta: Json
          request_id: string | null
          source: string | null
          stack: string | null
          url: string | null
          user_agent: string | null
          user_id_hash: string | null
        }
        Insert: {
          colno?: number | null
          created_at?: string
          id?: string
          kind?: string
          lineno?: number | null
          message: string
          meta?: Json
          request_id?: string | null
          source?: string | null
          stack?: string | null
          url?: string | null
          user_agent?: string | null
          user_id_hash?: string | null
        }
        Update: {
          colno?: number | null
          created_at?: string
          id?: string
          kind?: string
          lineno?: number | null
          message?: string
          meta?: Json
          request_id?: string | null
          source?: string | null
          stack?: string | null
          url?: string | null
          user_agent?: string | null
          user_id_hash?: string | null
        }
        Relationships: []
      }
      governance_link_events: {
        Row: {
          actor: string | null
          actor_label: string | null
          created_at: string
          event_type: string
          id: string
          left_kind: string
          left_ref: string
          link_id: string | null
          payload: Json
          relation: string
          right_kind: string
          right_ref: string
        }
        Insert: {
          actor?: string | null
          actor_label?: string | null
          created_at?: string
          event_type: string
          id?: string
          left_kind: string
          left_ref: string
          link_id?: string | null
          payload?: Json
          relation: string
          right_kind: string
          right_ref: string
        }
        Update: {
          actor?: string | null
          actor_label?: string | null
          created_at?: string
          event_type?: string
          id?: string
          left_kind?: string
          left_ref?: string
          link_id?: string | null
          payload?: Json
          relation?: string
          right_kind?: string
          right_ref?: string
        }
        Relationships: []
      }
      governance_links: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          left_kind: string
          left_ref: string
          note: string | null
          relation: string
          right_kind: string
          right_ref: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          left_kind: string
          left_ref: string
          note?: string | null
          relation: string
          right_kind: string
          right_ref: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          left_kind?: string
          left_ref?: string
          note?: string | null
          relation?: string
          right_kind?: string
          right_ref?: string
        }
        Relationships: []
      }
      heygen_videos: {
        Row: {
          created_at: string
          duration_s: number | null
          error: string | null
          heygen_video_id: string | null
          id: string
          kind: string
          requested_by: string | null
          script: string
          status: string
          subject_kind: string | null
          subject_ref: string | null
          thumbnail_url: string | null
          title: string
          updated_at: string
          video_url: string | null
        }
        Insert: {
          created_at?: string
          duration_s?: number | null
          error?: string | null
          heygen_video_id?: string | null
          id?: string
          kind: string
          requested_by?: string | null
          script: string
          status?: string
          subject_kind?: string | null
          subject_ref?: string | null
          thumbnail_url?: string | null
          title: string
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          created_at?: string
          duration_s?: number | null
          error?: string | null
          heygen_video_id?: string | null
          id?: string
          kind?: string
          requested_by?: string | null
          script?: string
          status?: string
          subject_kind?: string | null
          subject_ref?: string | null
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
          video_url?: string | null
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
      ingestion_runs: {
        Row: {
          created_at: string
          detail: Json
          duration_ms: number | null
          error: string | null
          finished_at: string | null
          id: string
          idempotency_key: string | null
          rows_failed: number
          rows_in: number
          rows_upserted: number
          source_key: string
          started_at: string
          status: string
          trigger: string
        }
        Insert: {
          created_at?: string
          detail?: Json
          duration_ms?: number | null
          error?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string | null
          rows_failed?: number
          rows_in?: number
          rows_upserted?: number
          source_key: string
          started_at?: string
          status?: string
          trigger?: string
        }
        Update: {
          created_at?: string
          detail?: Json
          duration_ms?: number | null
          error?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string | null
          rows_failed?: number
          rows_in?: number
          rows_upserted?: number
          source_key?: string
          started_at?: string
          status?: string
          trigger?: string
        }
        Relationships: []
      }
      ingestion_sources: {
        Row: {
          config: Json
          created_at: string
          description: string | null
          enabled: boolean
          kind: string
          last_error: string | null
          last_run_at: string | null
          last_status: string | null
          source_key: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          description?: string | null
          enabled?: boolean
          kind: string
          last_error?: string | null
          last_run_at?: string | null
          last_status?: string | null
          source_key: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          description?: string | null
          enabled?: boolean
          kind?: string
          last_error?: string | null
          last_run_at?: string | null
          last_status?: string | null
          source_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      lesson_events: {
        Row: {
          actor: string | null
          actor_label: string | null
          created_at: string
          event_type: string
          id: string
          lesson_id: string
          payload: Json
        }
        Insert: {
          actor?: string | null
          actor_label?: string | null
          created_at?: string
          event_type: string
          id?: string
          lesson_id: string
          payload?: Json
        }
        Update: {
          actor?: string | null
          actor_label?: string | null
          created_at?: string
          event_type?: string
          id?: string
          lesson_id?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "lesson_events_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      lessons: {
        Row: {
          applied_as: Json | null
          applied_at: string | null
          applied_by: string | null
          cadence: string
          category: string
          created_at: string
          dedupe_key: string
          evidence: Json
          id: string
          occurrences: number
          recommendation: string
          severity: string
          source: string | null
          source_window_end: string | null
          source_window_start: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          applied_as?: Json | null
          applied_at?: string | null
          applied_by?: string | null
          cadence?: string
          category: string
          created_at?: string
          dedupe_key: string
          evidence?: Json
          id?: string
          occurrences?: number
          recommendation: string
          severity: string
          source?: string | null
          source_window_end?: string | null
          source_window_start?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          applied_as?: Json | null
          applied_at?: string | null
          applied_by?: string | null
          cadence?: string
          category?: string
          created_at?: string
          dedupe_key?: string
          evidence?: Json
          id?: string
          occurrences?: number
          recommendation?: string
          severity?: string
          source?: string | null
          source_window_end?: string | null
          source_window_start?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      lessons_backfill_runs: {
        Row: {
          cost_usd: number | null
          error: string | null
          finished_at: string | null
          id: string
          lessons_created: number | null
          started_at: string
          status: string
          triggered_by: string | null
          window_days: number
        }
        Insert: {
          cost_usd?: number | null
          error?: string | null
          finished_at?: string | null
          id?: string
          lessons_created?: number | null
          started_at?: string
          status: string
          triggered_by?: string | null
          window_days: number
        }
        Update: {
          cost_usd?: number | null
          error?: string | null
          finished_at?: string | null
          id?: string
          lessons_created?: number | null
          started_at?: string
          status?: string
          triggered_by?: string | null
          window_days?: number
        }
        Relationships: []
      }
      lint_delta_runs: {
        Row: {
          bytes: number
          caller: string
          created_at: string
          duration_ms: number
          error_class: string | null
          error_message: string | null
          file_path: string
          id: string
          language: string
          meta: Json
          request_id: string | null
          status: string
        }
        Insert: {
          bytes?: number
          caller: string
          created_at?: string
          duration_ms?: number
          error_class?: string | null
          error_message?: string | null
          file_path: string
          id?: string
          language: string
          meta?: Json
          request_id?: string | null
          status: string
        }
        Update: {
          bytes?: number
          caller?: string
          created_at?: string
          duration_ms?: number
          error_class?: string | null
          error_message?: string | null
          file_path?: string
          id?: string
          language?: string
          meta?: Json
          request_id?: string | null
          status?: string
        }
        Relationships: []
      }
      memory_audit_log: {
        Row: {
          action: string
          actor: string | null
          created_at: string
          entry_key: string
          id: string
          new_value: Json | null
          note: string | null
          old_value: Json | null
          scope: string
        }
        Insert: {
          action: string
          actor?: string | null
          created_at?: string
          entry_key: string
          id?: string
          new_value?: Json | null
          note?: string | null
          old_value?: Json | null
          scope: string
        }
        Update: {
          action?: string
          actor?: string | null
          created_at?: string
          entry_key?: string
          id?: string
          new_value?: Json | null
          note?: string | null
          old_value?: Json | null
          scope?: string
        }
        Relationships: []
      }
      memory_settings: {
        Row: {
          auto_purge_enabled: boolean
          id: boolean
          night_agent_enabled: boolean
          night_allowed_kinds: Json
          night_blackout_dates: Json
          night_timezone: string
          night_window_end: string
          night_window_start: string
          updated_at: string
        }
        Insert: {
          auto_purge_enabled?: boolean
          id?: boolean
          night_agent_enabled?: boolean
          night_allowed_kinds?: Json
          night_blackout_dates?: Json
          night_timezone?: string
          night_window_end?: string
          night_window_start?: string
          updated_at?: string
        }
        Update: {
          auto_purge_enabled?: boolean
          id?: boolean
          night_agent_enabled?: boolean
          night_allowed_kinds?: Json
          night_blackout_dates?: Json
          night_timezone?: string
          night_window_end?: string
          night_window_start?: string
          updated_at?: string
        }
        Relationships: []
      }
      morning_review_discussion_messages: {
        Row: {
          body: string
          created_at: string
          discussion_id: string
          id: string
          model: string | null
          role: string
        }
        Insert: {
          body: string
          created_at?: string
          discussion_id: string
          id?: string
          model?: string | null
          role: string
        }
        Update: {
          body?: string
          created_at?: string
          discussion_id?: string
          id?: string
          model?: string | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "morning_review_discussion_messages_discussion_id_fkey"
            columns: ["discussion_id"]
            isOneToOne: false
            referencedRelation: "morning_review_discussions"
            referencedColumns: ["id"]
          },
        ]
      }
      morning_review_discussions: {
        Row: {
          closed_at: string | null
          created_at: string
          created_by: string | null
          id: string
          outcome: string | null
          panel_ref: string
          panel_title: string | null
          review_id: string
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          outcome?: string | null
          panel_ref: string
          panel_title?: string | null
          review_id: string
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          outcome?: string | null
          panel_ref?: string
          panel_title?: string | null
          review_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "morning_review_discussions_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "morning_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      morning_review_triage: {
        Row: {
          cleared_at: string | null
          id: string
          item_kind: string
          item_ref: string
          note: string | null
          set_at: string
          set_by: string | null
          state: string
        }
        Insert: {
          cleared_at?: string | null
          id?: string
          item_kind: string
          item_ref: string
          note?: string | null
          set_at?: string
          set_by?: string | null
          state: string
        }
        Update: {
          cleared_at?: string | null
          id?: string
          item_kind?: string
          item_ref?: string
          note?: string | null
          set_at?: string
          set_by?: string | null
          state?: string
        }
        Relationships: []
      }
      morning_reviews: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          created_at: string
          generated_by: string
          id: string
          kpis: Json
          night_throughput: Json
          open_findings: Json
          promotion_drift: Json
          review_date: string
          revisit_items: Json
          stuck_jobs: Json
          top_actions: Json
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          generated_by?: string
          id?: string
          kpis?: Json
          night_throughput?: Json
          open_findings?: Json
          promotion_drift?: Json
          review_date: string
          revisit_items?: Json
          stuck_jobs?: Json
          top_actions?: Json
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          generated_by?: string
          id?: string
          kpis?: Json
          night_throughput?: Json
          open_findings?: Json
          promotion_drift?: Json
          review_date?: string
          revisit_items?: Json
          stuck_jobs?: Json
          top_actions?: Json
        }
        Relationships: []
      }
      night_observations: {
        Row: {
          created_at: string
          id: string
          kind: string
          payload: Json
          severity: string
          shift_id: string
          subject_ref: Json
          summary: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          payload?: Json
          severity?: string
          shift_id: string
          subject_ref?: Json
          summary: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          payload?: Json
          severity?: string
          shift_id?: string
          subject_ref?: Json
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "night_observations_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "night_shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      night_proposals: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          kind: string
          payload: Json
          rationale: string | null
          shift_id: string
          source_observation_id: string | null
          status: string
          target_ref: Json
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          kind: string
          payload?: Json
          rationale?: string | null
          shift_id: string
          source_observation_id?: string | null
          status?: string
          target_ref?: Json
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          kind?: string
          payload?: Json
          rationale?: string | null
          shift_id?: string
          source_observation_id?: string | null
          status?: string
          target_ref?: Json
        }
        Relationships: [
          {
            foreignKeyName: "night_proposals_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "night_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "night_proposals_source_observation_id_fkey"
            columns: ["source_observation_id"]
            isOneToOne: false
            referencedRelation: "night_observations"
            referencedColumns: ["id"]
          },
        ]
      }
      night_shift_job_attempts: {
        Row: {
          action_id: string
          attempted_at: string
          id: string
          night_shift_id: string | null
          outcome: string
        }
        Insert: {
          action_id: string
          attempted_at?: string
          id?: string
          night_shift_id?: string | null
          outcome?: string
        }
        Update: {
          action_id?: string
          attempted_at?: string
          id?: string
          night_shift_id?: string | null
          outcome?: string
        }
        Relationships: [
          {
            foreignKeyName: "night_shift_job_attempts_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "discussion_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "night_shift_job_attempts_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "discussion_actions_stuck_in_night"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "night_shift_job_attempts_night_shift_id_fkey"
            columns: ["night_shift_id"]
            isOneToOne: false
            referencedRelation: "night_shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      night_shifts: {
        Row: {
          attempts: number
          commit_sha: string | null
          created_at: string
          ended_at: string | null
          heartbeat_at: string | null
          id: string
          last_error: string | null
          max_retries: number
          started_at: string
          status: string
          summary: Json
          window_end: string
          window_start: string
        }
        Insert: {
          attempts?: number
          commit_sha?: string | null
          created_at?: string
          ended_at?: string | null
          heartbeat_at?: string | null
          id?: string
          last_error?: string | null
          max_retries?: number
          started_at?: string
          status?: string
          summary?: Json
          window_end: string
          window_start: string
        }
        Update: {
          attempts?: number
          commit_sha?: string | null
          created_at?: string
          ended_at?: string | null
          heartbeat_at?: string | null
          id?: string
          last_error?: string | null
          max_retries?: number
          started_at?: string
          status?: string
          summary?: Json
          window_end?: string
          window_start?: string
        }
        Relationships: []
      }
      notebook_entries: {
        Row: {
          author: string | null
          body: string | null
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["notebook_kind"]
          pinned: boolean
          status: Database["public"]["Enums"]["notebook_status"]
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          author?: string | null
          body?: string | null
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["notebook_kind"]
          pinned?: boolean
          status?: Database["public"]["Enums"]["notebook_status"]
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          author?: string | null
          body?: string | null
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["notebook_kind"]
          pinned?: boolean
          status?: Database["public"]["Enums"]["notebook_status"]
          tags?: string[]
          title?: string
          updated_at?: string
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
          {
            foreignKeyName: "okr_measurements_okr_node_id_fkey"
            columns: ["okr_node_id"]
            isOneToOne: true
            referencedRelation: "roadmap_task_outcome_health"
            referencedColumns: ["okr_node_id"]
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
            foreignKeyName: "okr_node_events_okr_node_id_fkey"
            columns: ["okr_node_id"]
            isOneToOne: false
            referencedRelation: "roadmap_task_outcome_health"
            referencedColumns: ["okr_node_id"]
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
            foreignKeyName: "okr_nodes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "roadmap_task_outcome_health"
            referencedColumns: ["okr_node_id"]
          },
          {
            foreignKeyName: "okr_nodes_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "okr_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "okr_nodes_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "roadmap_task_outcome_health"
            referencedColumns: ["okr_node_id"]
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
      operator_dashboards: {
        Row: {
          active_tab_id: string | null
          created_at: string
          id: string
          tabs: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          active_tab_id?: string | null
          created_at?: string
          id?: string
          tabs?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          active_tab_id?: string | null
          created_at?: string
          id?: string
          tabs?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      operator_messages: {
        Row: {
          chat_id: number
          created_at: string
          direction: string
          id: string
          intent: string | null
          raw: Json
          text: string | null
          update_id: number | null
        }
        Insert: {
          chat_id: number
          created_at?: string
          direction: string
          id?: string
          intent?: string | null
          raw?: Json
          text?: string | null
          update_id?: number | null
        }
        Update: {
          chat_id?: number
          created_at?: string
          direction?: string
          id?: string
          intent?: string | null
          raw?: Json
          text?: string | null
          update_id?: number | null
        }
        Relationships: []
      }
      overnight_recommendations: {
        Row: {
          acted_at: string | null
          acted_by: string | null
          blockers: Json
          created_at: string
          generated_at: string
          id: string
          phase_id: string
          phase_key: string
          reasons: Json
          scheduled_for: string
          score: number
          status: string
        }
        Insert: {
          acted_at?: string | null
          acted_by?: string | null
          blockers?: Json
          created_at?: string
          generated_at?: string
          id?: string
          phase_id: string
          phase_key: string
          reasons?: Json
          scheduled_for: string
          score?: number
          status?: string
        }
        Update: {
          acted_at?: string | null
          acted_by?: string | null
          blockers?: Json
          created_at?: string
          generated_at?: string
          id?: string
          phase_id?: string
          phase_key?: string
          reasons?: Json
          scheduled_for?: string
          score?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "overnight_recommendations_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "roadmap_phase_gate_status"
            referencedColumns: ["phase_id"]
          },
          {
            foreignKeyName: "overnight_recommendations_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "roadmap_phases"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_tasks: {
        Row: {
          area: string | null
          created_at: string
          detail: string | null
          id: string
          notes: string | null
          sort_order: number
          status: Database["public"]["Enums"]["plan_status"]
          title: string
          updated_at: string
          updated_by: string | null
          updated_by_label: string | null
          workstream_id: string
        }
        Insert: {
          area?: string | null
          created_at?: string
          detail?: string | null
          id?: string
          notes?: string | null
          sort_order?: number
          status?: Database["public"]["Enums"]["plan_status"]
          title: string
          updated_at?: string
          updated_by?: string | null
          updated_by_label?: string | null
          workstream_id: string
        }
        Update: {
          area?: string | null
          created_at?: string
          detail?: string | null
          id?: string
          notes?: string | null
          sort_order?: number
          status?: Database["public"]["Enums"]["plan_status"]
          title?: string
          updated_at?: string
          updated_by?: string | null
          updated_by_label?: string | null
          workstream_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_tasks_workstream_id_fkey"
            columns: ["workstream_id"]
            isOneToOne: false
            referencedRelation: "cost_summary_by_workstream"
            referencedColumns: ["workstream_id"]
          },
          {
            foreignKeyName: "plan_tasks_workstream_id_fkey"
            columns: ["workstream_id"]
            isOneToOne: false
            referencedRelation: "plan_workstreams"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_workstreams: {
        Row: {
          created_at: string
          est_ai_build_usd: number
          est_human_hours: number
          id: string
          slug: string
          sort_order: number
          status: Database["public"]["Enums"]["plan_status"]
          summary: string | null
          target_week: number | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          est_ai_build_usd?: number
          est_human_hours?: number
          id?: string
          slug: string
          sort_order?: number
          status?: Database["public"]["Enums"]["plan_status"]
          summary?: string | null
          target_week?: number | null
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          est_ai_build_usd?: number
          est_human_hours?: number
          id?: string
          slug?: string
          sort_order?: number
          status?: Database["public"]["Enums"]["plan_status"]
          summary?: string | null
          target_week?: number | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      platform_allowlist: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          platform: string
          principal: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          platform: string
          principal: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          platform?: string
          principal?: string
        }
        Relationships: []
      }
      platform_allowlist_audit: {
        Row: {
          action: string
          actor: string | null
          actor_label: string | null
          allowlist_id: string | null
          created_at: string
          id: string
          note: string | null
          platform: string
          principal: string
        }
        Insert: {
          action: string
          actor?: string | null
          actor_label?: string | null
          allowlist_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          platform: string
          principal: string
        }
        Update: {
          action?: string
          actor?: string | null
          actor_label?: string | null
          allowlist_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          platform?: string
          principal?: string
        }
        Relationships: []
      }
      qa_checks: {
        Row: {
          created_at: string
          criterion: string
          id: string
          kind: string
          last_action: string | null
          last_actor: string | null
          last_actor_label: string | null
          last_checked_at: string | null
          note: string | null
          phase_key: string
          probe: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          criterion: string
          id?: string
          kind?: string
          last_action?: string | null
          last_actor?: string | null
          last_actor_label?: string | null
          last_checked_at?: string | null
          note?: string | null
          phase_key: string
          probe?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          criterion?: string
          id?: string
          kind?: string
          last_action?: string | null
          last_actor?: string | null
          last_actor_label?: string | null
          last_checked_at?: string | null
          note?: string | null
          phase_key?: string
          probe?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      retention_settings: {
        Row: {
          description: string | null
          retention_days: number
          table_name: string
          updated_at: string
        }
        Insert: {
          description?: string | null
          retention_days?: number
          table_name: string
          updated_at?: string
        }
        Update: {
          description?: string | null
          retention_days?: number
          table_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      rethink_tasks: {
        Row: {
          created_at: string
          id: string
          original_proposal: Json
          reason: string | null
          resolved_at: string | null
          status: string
          temp_fix: string | null
          topic: string
        }
        Insert: {
          created_at?: string
          id?: string
          original_proposal?: Json
          reason?: string | null
          resolved_at?: string | null
          status?: string
          temp_fix?: string | null
          topic: string
        }
        Update: {
          created_at?: string
          id?: string
          original_proposal?: Json
          reason?: string | null
          resolved_at?: string | null
          status?: string
          temp_fix?: string | null
          topic?: string
        }
        Relationships: []
      }
      roadmap_autolog_settings: {
        Row: {
          capture_duration: boolean
          capture_model: boolean
          capture_prompt: boolean
          capture_request_meta: boolean
          capture_response: boolean
          capture_response_meta: boolean
          capture_tokens: boolean
          enabled: boolean
          extract_issues_fixes: boolean
          id: boolean
          source_ai_gateway: boolean
          source_awip_api: boolean
          source_lovable_agent: boolean
          updated_at: string
        }
        Insert: {
          capture_duration?: boolean
          capture_model?: boolean
          capture_prompt?: boolean
          capture_request_meta?: boolean
          capture_response?: boolean
          capture_response_meta?: boolean
          capture_tokens?: boolean
          enabled?: boolean
          extract_issues_fixes?: boolean
          id?: boolean
          source_ai_gateway?: boolean
          source_awip_api?: boolean
          source_lovable_agent?: boolean
          updated_at?: string
        }
        Update: {
          capture_duration?: boolean
          capture_model?: boolean
          capture_prompt?: boolean
          capture_request_meta?: boolean
          capture_response?: boolean
          capture_response_meta?: boolean
          capture_tokens?: boolean
          enabled?: boolean
          extract_issues_fixes?: boolean
          id?: boolean
          source_ai_gateway?: boolean
          source_awip_api?: boolean
          source_lovable_agent?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      roadmap_autolog_skips: {
        Row: {
          author: string | null
          created_at: string
          id: string
          model: string | null
          reason: string
          request_meta: Json
          source: string
          summary: string | null
          task_id: string | null
        }
        Insert: {
          author?: string | null
          created_at?: string
          id?: string
          model?: string | null
          reason: string
          request_meta?: Json
          source: string
          summary?: string | null
          task_id?: string | null
        }
        Update: {
          author?: string | null
          created_at?: string
          id?: string
          model?: string | null
          reason?: string
          request_meta?: Json
          source?: string
          summary?: string | null
          task_id?: string | null
        }
        Relationships: []
      }
      roadmap_comments: {
        Row: {
          author: string
          body: string
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["roadmap_comment_kind"]
          resolved: boolean
          task_id: string
        }
        Insert: {
          author: string
          body: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["roadmap_comment_kind"]
          resolved?: boolean
          task_id: string
        }
        Update: {
          author?: string
          body?: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["roadmap_comment_kind"]
          resolved?: boolean
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "roadmap_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "roadmap_task_outcome_health"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "roadmap_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "roadmap_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      roadmap_finding_discussion_messages: {
        Row: {
          body: string
          created_at: string
          discussion_id: string
          id: string
          model: string | null
          role: string
          source: string
        }
        Insert: {
          body: string
          created_at?: string
          discussion_id: string
          id?: string
          model?: string | null
          role: string
          source: string
        }
        Update: {
          body?: string
          created_at?: string
          discussion_id?: string
          id?: string
          model?: string | null
          role?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "roadmap_finding_discussion_messages_discussion_id_fkey"
            columns: ["discussion_id"]
            isOneToOne: false
            referencedRelation: "roadmap_finding_discussions"
            referencedColumns: ["id"]
          },
        ]
      }
      roadmap_finding_discussions: {
        Row: {
          created_at: string
          ended_at: string | null
          finding_id: string | null
          id: string
          mode: string
          started_by_user_id: string | null
          subject_id: string
          subject_ordinal: number | null
          subject_type: string
          title: string | null
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          finding_id?: string | null
          id?: string
          mode: string
          started_by_user_id?: string | null
          subject_id: string
          subject_ordinal?: number | null
          subject_type?: string
          title?: string | null
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          finding_id?: string | null
          id?: string
          mode?: string
          started_by_user_id?: string | null
          subject_id?: string
          subject_ordinal?: number | null
          subject_type?: string
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roadmap_finding_discussions_finding_id_fkey"
            columns: ["finding_id"]
            isOneToOne: false
            referencedRelation: "roadmap_review_findings"
            referencedColumns: ["id"]
          },
        ]
      }
      roadmap_phase_overnight_runs: {
        Row: {
          attempts: number
          created_at: string
          error: string | null
          finished_at: string | null
          heartbeat_at: string | null
          id: string
          last_error: string | null
          max_retries: number
          model: string | null
          phase_id: string
          phase_key: string
          requested_at: string
          requested_by: string
          result: Json | null
          scheduled_for: string
          started_at: string | null
          status: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          error?: string | null
          finished_at?: string | null
          heartbeat_at?: string | null
          id?: string
          last_error?: string | null
          max_retries?: number
          model?: string | null
          phase_id: string
          phase_key: string
          requested_at?: string
          requested_by: string
          result?: Json | null
          scheduled_for?: string
          started_at?: string | null
          status?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          error?: string | null
          finished_at?: string | null
          heartbeat_at?: string | null
          id?: string
          last_error?: string | null
          max_retries?: number
          model?: string | null
          phase_id?: string
          phase_key?: string
          requested_at?: string
          requested_by?: string
          result?: Json | null
          scheduled_for?: string
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "roadmap_phase_overnight_runs_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "roadmap_phase_gate_status"
            referencedColumns: ["phase_id"]
          },
          {
            foreignKeyName: "roadmap_phase_overnight_runs_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "roadmap_phases"
            referencedColumns: ["id"]
          },
        ]
      }
      roadmap_phase_signoffs: {
        Row: {
          approval_id: string | null
          approver: string | null
          approver_user_id: string | null
          created_at: string
          decided_at: string
          gate_snapshot: Json
          id: string
          notes: string | null
          override_rationale: string | null
          phase_id: string
          phase_key: string
        }
        Insert: {
          approval_id?: string | null
          approver?: string | null
          approver_user_id?: string | null
          created_at?: string
          decided_at?: string
          gate_snapshot?: Json
          id?: string
          notes?: string | null
          override_rationale?: string | null
          phase_id: string
          phase_key: string
        }
        Update: {
          approval_id?: string | null
          approver?: string | null
          approver_user_id?: string | null
          created_at?: string
          decided_at?: string
          gate_snapshot?: Json
          id?: string
          notes?: string | null
          override_rationale?: string | null
          phase_id?: string
          phase_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "roadmap_phase_signoffs_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "roadmap_phase_gate_status"
            referencedColumns: ["phase_id"]
          },
          {
            foreignKeyName: "roadmap_phase_signoffs_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "roadmap_phases"
            referencedColumns: ["id"]
          },
        ]
      }
      roadmap_phases: {
        Row: {
          created_at: string
          id: string
          key: string
          manual_override_at: string | null
          manual_override_by: string | null
          manual_override_rationale: string | null
          order: number
          run_overnight: boolean
          run_overnight_until: string | null
          status: Database["public"]["Enums"]["roadmap_status"]
          summary: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          manual_override_at?: string | null
          manual_override_by?: string | null
          manual_override_rationale?: string | null
          order?: number
          run_overnight?: boolean
          run_overnight_until?: string | null
          status?: Database["public"]["Enums"]["roadmap_status"]
          summary?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          manual_override_at?: string | null
          manual_override_by?: string | null
          manual_override_rationale?: string | null
          order?: number
          run_overnight?: boolean
          run_overnight_until?: string | null
          status?: Database["public"]["Enums"]["roadmap_status"]
          summary?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      roadmap_review_findings: {
        Row: {
          acknowledged: boolean
          area: string | null
          body: string | null
          category: string | null
          created_at: string
          decision_outcome: string | null
          decision_recorded_at: string | null
          decision_recorded_by: string | null
          decision_summary: string | null
          diff_window_end: string | null
          diff_window_start: string | null
          discussion_status: string
          id: string
          reviewed_at: string
          reviewer_model: string
          severity: string
          short_num: number | null
          title: string
        }
        Insert: {
          acknowledged?: boolean
          area?: string | null
          body?: string | null
          category?: string | null
          created_at?: string
          decision_outcome?: string | null
          decision_recorded_at?: string | null
          decision_recorded_by?: string | null
          decision_summary?: string | null
          diff_window_end?: string | null
          diff_window_start?: string | null
          discussion_status?: string
          id?: string
          reviewed_at?: string
          reviewer_model: string
          severity?: string
          short_num?: number | null
          title: string
        }
        Update: {
          acknowledged?: boolean
          area?: string | null
          body?: string | null
          category?: string | null
          created_at?: string
          decision_outcome?: string | null
          decision_recorded_at?: string | null
          decision_recorded_by?: string | null
          decision_summary?: string | null
          diff_window_end?: string | null
          diff_window_start?: string | null
          discussion_status?: string
          id?: string
          reviewed_at?: string
          reviewer_model?: string
          severity?: string
          short_num?: number | null
          title?: string
        }
        Relationships: []
      }
      roadmap_sprints: {
        Row: {
          created_at: string
          ends_on: string | null
          goal: string | null
          id: string
          key: string
          order: number
          phase_id: string
          starts_on: string | null
          status: Database["public"]["Enums"]["roadmap_status"]
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          ends_on?: string | null
          goal?: string | null
          id?: string
          key: string
          order?: number
          phase_id: string
          starts_on?: string | null
          status?: Database["public"]["Enums"]["roadmap_status"]
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          ends_on?: string | null
          goal?: string | null
          id?: string
          key?: string
          order?: number
          phase_id?: string
          starts_on?: string | null
          status?: Database["public"]["Enums"]["roadmap_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "roadmap_sprints_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "roadmap_phase_gate_status"
            referencedColumns: ["phase_id"]
          },
          {
            foreignKeyName: "roadmap_sprints_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "roadmap_phases"
            referencedColumns: ["id"]
          },
        ]
      }
      roadmap_task_activity: {
        Row: {
          author: string | null
          author_label: string | null
          created_at: string
          field: string
          id: string
          new_value: string | null
          old_value: string | null
          task_id: string
        }
        Insert: {
          author?: string | null
          author_label?: string | null
          created_at?: string
          field: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          task_id: string
        }
        Update: {
          author?: string | null
          author_label?: string | null
          created_at?: string
          field?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "roadmap_task_activity_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "roadmap_task_outcome_health"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "roadmap_task_activity_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "roadmap_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      roadmap_task_checklist: {
        Row: {
          category: string
          checked: boolean
          checked_at: string | null
          checked_by: string | null
          created_at: string
          id: string
          item_key: string
          label: string
          note: string | null
          order: number
          task_id: string
          updated_at: string
        }
        Insert: {
          category?: string
          checked?: boolean
          checked_at?: string | null
          checked_by?: string | null
          created_at?: string
          id?: string
          item_key: string
          label: string
          note?: string | null
          order?: number
          task_id: string
          updated_at?: string
        }
        Update: {
          category?: string
          checked?: boolean
          checked_at?: string | null
          checked_by?: string | null
          created_at?: string
          id?: string
          item_key?: string
          label?: string
          note?: string | null
          order?: number
          task_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      roadmap_task_evidence: {
        Row: {
          added_by: string | null
          checklist_item: string | null
          created_at: string
          id: string
          kind: string
          note: string | null
          source: string | null
          storage_path: string | null
          task_id: string
          title: string
          updated_at: string
          url: string | null
        }
        Insert: {
          added_by?: string | null
          checklist_item?: string | null
          created_at?: string
          id?: string
          kind?: string
          note?: string | null
          source?: string | null
          storage_path?: string | null
          task_id: string
          title: string
          updated_at?: string
          url?: string | null
        }
        Update: {
          added_by?: string | null
          checklist_item?: string | null
          created_at?: string
          id?: string
          kind?: string
          note?: string | null
          source?: string | null
          storage_path?: string | null
          task_id?: string
          title?: string
          updated_at?: string
          url?: string | null
        }
        Relationships: []
      }
      roadmap_task_reviews: {
        Row: {
          checklist_done: number
          checklist_snapshot: Json
          checklist_total: number
          created_at: string
          decision: string
          id: string
          notes: string | null
          reviewer: string | null
          reviewer_id: string | null
          task_id: string
        }
        Insert: {
          checklist_done?: number
          checklist_snapshot?: Json
          checklist_total?: number
          created_at?: string
          decision: string
          id?: string
          notes?: string | null
          reviewer?: string | null
          reviewer_id?: string | null
          task_id: string
        }
        Update: {
          checklist_done?: number
          checklist_snapshot?: Json
          checklist_total?: number
          created_at?: string
          decision?: string
          id?: string
          notes?: string | null
          reviewer?: string | null
          reviewer_id?: string | null
          task_id?: string
        }
        Relationships: []
      }
      roadmap_tasks: {
        Row: {
          acceptance: string | null
          blocked_by: string[]
          capability_id: string | null
          created_at: string
          description: string | null
          id: string
          key: string
          module: string | null
          okr_link_kind: string | null
          okr_node_id: string | null
          order: number
          owner: string | null
          review_notes: string | null
          review_status: string
          reviewed_at: string | null
          reviewed_by: string | null
          sprint_id: string
          status: Database["public"]["Enums"]["roadmap_task_status"]
          title: string
          updated_at: string
        }
        Insert: {
          acceptance?: string | null
          blocked_by?: string[]
          capability_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          key: string
          module?: string | null
          okr_link_kind?: string | null
          okr_node_id?: string | null
          order?: number
          owner?: string | null
          review_notes?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          sprint_id: string
          status?: Database["public"]["Enums"]["roadmap_task_status"]
          title: string
          updated_at?: string
        }
        Update: {
          acceptance?: string | null
          blocked_by?: string[]
          capability_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          key?: string
          module?: string | null
          okr_link_kind?: string | null
          okr_node_id?: string | null
          order?: number
          owner?: string | null
          review_notes?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          sprint_id?: string
          status?: Database["public"]["Enums"]["roadmap_task_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "roadmap_tasks_okr_node_id_fkey"
            columns: ["okr_node_id"]
            isOneToOne: false
            referencedRelation: "okr_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roadmap_tasks_okr_node_id_fkey"
            columns: ["okr_node_id"]
            isOneToOne: false
            referencedRelation: "roadmap_task_outcome_health"
            referencedColumns: ["okr_node_id"]
          },
          {
            foreignKeyName: "roadmap_tasks_sprint_id_fkey"
            columns: ["sprint_id"]
            isOneToOne: false
            referencedRelation: "roadmap_sprints"
            referencedColumns: ["id"]
          },
        ]
      }
      roadmap_work_log: {
        Row: {
          author: string | null
          created_at: string
          duration_ms: number | null
          ended_at: string | null
          fixes: string | null
          id: string
          issues: string | null
          model: string | null
          model_provider: string | null
          prompt_preview: string | null
          request_meta: Json
          response_meta: Json
          response_preview: string | null
          source: string
          started_at: string
          summary: string | null
          task_id: string
          tokens_in: number | null
          tokens_out: number | null
          tokens_total: number | null
        }
        Insert: {
          author?: string | null
          created_at?: string
          duration_ms?: number | null
          ended_at?: string | null
          fixes?: string | null
          id?: string
          issues?: string | null
          model?: string | null
          model_provider?: string | null
          prompt_preview?: string | null
          request_meta?: Json
          response_meta?: Json
          response_preview?: string | null
          source?: string
          started_at: string
          summary?: string | null
          task_id: string
          tokens_in?: number | null
          tokens_out?: number | null
          tokens_total?: number | null
        }
        Update: {
          author?: string | null
          created_at?: string
          duration_ms?: number | null
          ended_at?: string | null
          fixes?: string | null
          id?: string
          issues?: string | null
          model?: string | null
          model_provider?: string | null
          prompt_preview?: string | null
          request_meta?: Json
          response_meta?: Json
          response_preview?: string | null
          source?: string
          started_at?: string
          summary?: string | null
          task_id?: string
          tokens_in?: number | null
          tokens_out?: number | null
          tokens_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "roadmap_work_log_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "roadmap_task_outcome_health"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "roadmap_work_log_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "roadmap_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      role_change_audit: {
        Row: {
          action: string
          actor_user_id: string
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          target_user_id: string
        }
        Insert: {
          action: string
          actor_user_id: string
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          target_user_id: string
        }
        Update: {
          action?: string
          actor_user_id?: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          target_user_id?: string
        }
        Relationships: []
      }
      runbooks: {
        Row: {
          author: string | null
          body: string
          created_at: string
          format: string
          id: string
          slug: string
          steps: Json
          summary: string | null
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          author?: string | null
          body?: string
          created_at?: string
          format?: string
          id?: string
          slug: string
          steps?: Json
          summary?: string | null
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          author?: string | null
          body?: string
          created_at?: string
          format?: string
          id?: string
          slug?: string
          steps?: Json
          summary?: string | null
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      sentinel_findings: {
        Row: {
          created_at: string
          dedupe_key: string
          first_seen_at: string
          id: string
          kind: string
          last_seen_at: string
          payload: Json
          resolved_at: string | null
          severity: string
          status: string
          subject_ref: Json
          summary: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          dedupe_key: string
          first_seen_at?: string
          id?: string
          kind: string
          last_seen_at?: string
          payload?: Json
          resolved_at?: string | null
          severity?: string
          status?: string
          subject_ref?: Json
          summary: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          dedupe_key?: string
          first_seen_at?: string
          id?: string
          kind?: string
          last_seen_at?: string
          payload?: Json
          resolved_at?: string | null
          severity?: string
          status?: string
          subject_ref?: Json
          summary?: string
          updated_at?: string
        }
        Relationships: []
      }
      sentinel_triage_activity: {
        Row: {
          acknowledged_by: string[]
          action_id: string
          action_short_num: number | null
          action_title: string | null
          created_at: string
          event_kind: string
          finding_count: number
          finding_ids: string[]
          id: string
          triggered_by: string | null
          triggered_by_label: string | null
        }
        Insert: {
          acknowledged_by?: string[]
          action_id: string
          action_short_num?: number | null
          action_title?: string | null
          created_at?: string
          event_kind: string
          finding_count: number
          finding_ids?: string[]
          id?: string
          triggered_by?: string | null
          triggered_by_label?: string | null
        }
        Update: {
          acknowledged_by?: string[]
          action_id?: string
          action_short_num?: number | null
          action_title?: string | null
          created_at?: string
          event_kind?: string
          finding_count?: number
          finding_ids?: string[]
          id?: string
          triggered_by?: string | null
          triggered_by_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sentinel_triage_activity_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "discussion_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sentinel_triage_activity_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "discussion_actions_stuck_in_night"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_gateway_logs: {
        Row: {
          attempt: number
          created_at: string
          detail: Json | null
          endpoint: string
          error: string | null
          id: string
          latency_ms: number | null
          ok: boolean
          status_code: number | null
        }
        Insert: {
          attempt?: number
          created_at?: string
          detail?: Json | null
          endpoint: string
          error?: string | null
          id?: string
          latency_ms?: number | null
          ok?: boolean
          status_code?: number | null
        }
        Update: {
          attempt?: number
          created_at?: string
          detail?: Json | null
          endpoint?: string
          error?: string | null
          id?: string
          latency_ms?: number | null
          ok?: boolean
          status_code?: number | null
        }
        Relationships: []
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
      test_runs: {
        Row: {
          branch: string | null
          commit_sha: string | null
          created_at: string
          detail: Json
          duration_ms: number | null
          failed: number | null
          id: string
          passed: number | null
          skipped: number | null
          status: string
          suite: string
          total: number | null
          workflow_run_url: string | null
        }
        Insert: {
          branch?: string | null
          commit_sha?: string | null
          created_at?: string
          detail?: Json
          duration_ms?: number | null
          failed?: number | null
          id?: string
          passed?: number | null
          skipped?: number | null
          status: string
          suite: string
          total?: number | null
          workflow_run_url?: string | null
        }
        Update: {
          branch?: string | null
          commit_sha?: string | null
          created_at?: string
          detail?: Json
          duration_ms?: number | null
          failed?: number | null
          id?: string
          passed?: number | null
          skipped?: number | null
          status?: string
          suite?: string
          total?: number | null
          workflow_run_url?: string | null
        }
        Relationships: []
      }
      tomorrow_plan_blocks: {
        Row: {
          created_at: string
          est_minutes: number | null
          id: string
          ordinal: number
          plan_id: string
          summary: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          est_minutes?: number | null
          id?: string
          ordinal: number
          plan_id: string
          summary?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          est_minutes?: number | null
          id?: string
          ordinal?: number
          plan_id?: string
          summary?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tomorrow_plan_blocks_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "tomorrow_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      tomorrow_plan_items: {
        Row: {
          auto_done: boolean | null
          block_id: string
          created_at: string
          detail: string | null
          done_at: string | null
          id: string
          label: string
          manual_done: boolean
          notes: string | null
          ordinal: number
          source_kind: string
          source_ref: string | null
          updated_at: string
        }
        Insert: {
          auto_done?: boolean | null
          block_id: string
          created_at?: string
          detail?: string | null
          done_at?: string | null
          id?: string
          label: string
          manual_done?: boolean
          notes?: string | null
          ordinal: number
          source_kind?: string
          source_ref?: string | null
          updated_at?: string
        }
        Update: {
          auto_done?: boolean | null
          block_id?: string
          created_at?: string
          detail?: string | null
          done_at?: string | null
          id?: string
          label?: string
          manual_done?: boolean
          notes?: string | null
          ordinal?: number
          source_kind?: string
          source_ref?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tomorrow_plan_items_block_id_fkey"
            columns: ["block_id"]
            isOneToOne: false
            referencedRelation: "tomorrow_plan_blocks"
            referencedColumns: ["id"]
          },
        ]
      }
      tomorrow_plans: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          plan_date: string
          status: string
          success_criteria: Json
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          plan_date: string
          status?: string
          success_criteria?: Json
          title?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          plan_date?: string
          status?: string
          success_criteria?: Json
          title?: string
          updated_at?: string
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
      voice_config: {
        Row: {
          created_at: string
          last_validated_at: string | null
          last_validation: Json | null
          mic_label: string | null
          rork_enabled: boolean
          stt_provider: string
          transport: string
          tts_provider: string
          tts_voice: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          last_validated_at?: string | null
          last_validation?: Json | null
          mic_label?: string | null
          rork_enabled?: boolean
          stt_provider?: string
          transport?: string
          tts_provider?: string
          tts_voice?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          last_validated_at?: string | null
          last_validation?: Json | null
          mic_label?: string | null
          rork_enabled?: boolean
          stt_provider?: string
          transport?: string
          tts_provider?: string
          tts_voice?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      walkthrough_checks: {
        Row: {
          capability_id: string | null
          created_at: string
          detail: Json
          error: string | null
          http_status: number | null
          id: string
          kind: string
          latency_ms: number | null
          run_id: string
          severity: string
          status: string
          target: string
        }
        Insert: {
          capability_id?: string | null
          created_at?: string
          detail?: Json
          error?: string | null
          http_status?: number | null
          id?: string
          kind: string
          latency_ms?: number | null
          run_id: string
          severity?: string
          status: string
          target: string
        }
        Update: {
          capability_id?: string | null
          created_at?: string
          detail?: Json
          error?: string | null
          http_status?: number | null
          id?: string
          kind?: string
          latency_ms?: number | null
          run_id?: string
          severity?: string
          status?: string
          target?: string
        }
        Relationships: [
          {
            foreignKeyName: "walkthrough_checks_capability_id_fkey"
            columns: ["capability_id"]
            isOneToOne: false
            referencedRelation: "capabilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "walkthrough_checks_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "walkthrough_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      walkthrough_runs: {
        Row: {
          created_at: string
          duration_ms: number | null
          failed: number
          finished_at: string | null
          id: string
          passed: number
          skipped: number
          started_at: string
          status: string
          summary: Json
          total: number
          trigger: string
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          failed?: number
          finished_at?: string | null
          id?: string
          passed?: number
          skipped?: number
          started_at?: string
          status?: string
          summary?: Json
          total?: number
          trigger?: string
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          failed?: number
          finished_at?: string | null
          id?: string
          passed?: number
          skipped?: number
          started_at?: string
          status?: string
          summary?: Json
          total?: number
          trigger?: string
        }
        Relationships: []
      }
      whats_new_entries: {
        Row: {
          area: string
          created_at: string
          created_by: string | null
          draft_meta: Json
          how_to_use: string
          id: string
          impact: string
          model: string | null
          published_at: string | null
          shipped_at: string
          slug: string | null
          source_refs: Json
          status: string
          title: string
          updated_at: string
          what: string
          why: string
        }
        Insert: {
          area: string
          created_at?: string
          created_by?: string | null
          draft_meta?: Json
          how_to_use?: string
          id?: string
          impact?: string
          model?: string | null
          published_at?: string | null
          shipped_at?: string
          slug?: string | null
          source_refs?: Json
          status?: string
          title: string
          updated_at?: string
          what?: string
          why?: string
        }
        Update: {
          area?: string
          created_at?: string
          created_by?: string | null
          draft_meta?: Json
          how_to_use?: string
          id?: string
          impact?: string
          model?: string | null
          published_at?: string | null
          shipped_at?: string
          slug?: string | null
          source_refs?: Json
          status?: string
          title?: string
          updated_at?: string
          what?: string
          why?: string
        }
        Relationships: []
      }
      whats_new_sources: {
        Row: {
          dismissed: boolean
          entry_id: string | null
          id: string
          kind: string
          meta: Json
          ref: string
          seen_at: string
        }
        Insert: {
          dismissed?: boolean
          entry_id?: string | null
          id?: string
          kind: string
          meta?: Json
          ref: string
          seen_at?: string
        }
        Update: {
          dismissed?: boolean
          entry_id?: string | null
          id?: string
          kind?: string
          meta?: Json
          ref?: string
          seen_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whats_new_sources_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "whats_new_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      workstream_signoff_events: {
        Row: {
          actor: string | null
          actor_label: string
          created_at: string
          event_type: string
          id: string
          payload: Json
          workstream: string
        }
        Insert: {
          actor?: string | null
          actor_label: string
          created_at?: string
          event_type: string
          id?: string
          payload?: Json
          workstream: string
        }
        Update: {
          actor?: string | null
          actor_label?: string
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json
          workstream?: string
        }
        Relationships: []
      }
      workstream_signoffs: {
        Row: {
          created_at: string
          evidence: Json
          locked: boolean
          notes: string | null
          overrides: Json
          signed_off_at: string
          signed_off_by: string | null
          signed_off_by_label: string
          updated_at: string
          workstream: string
        }
        Insert: {
          created_at?: string
          evidence?: Json
          locked?: boolean
          notes?: string | null
          overrides?: Json
          signed_off_at?: string
          signed_off_by?: string | null
          signed_off_by_label: string
          updated_at?: string
          workstream: string
        }
        Update: {
          created_at?: string
          evidence?: Json
          locked?: boolean
          notes?: string | null
          overrides?: Json
          signed_off_at?: string
          signed_off_by?: string | null
          signed_off_by_label?: string
          updated_at?: string
          workstream?: string
        }
        Relationships: []
      }
    }
    Views: {
      cost_actuals_30d: {
        Row: {
          actual_usd_30d: number | null
          completion_tokens_30d: number | null
          job: string | null
          last_run_at: string | null
          prompt_tokens_30d: number | null
          runs: number | null
        }
        Relationships: []
      }
      cost_summary_by_workstream: {
        Row: {
          actual_usd_30d: number | null
          est_monthly_usd: number | null
          est_oneshot_usd: number | null
          jobs: string[] | null
          slug: string | null
          title: string | null
          workstream_id: string | null
        }
        Relationships: []
      }
      discussion_actions_stuck_in_night: {
        Row: {
          attempts: number | null
          id: string | null
          last_attempt_at: string | null
          priority: string | null
          risk: string | null
          short_num: number | null
          title: string | null
        }
        Relationships: []
      }
      heygen_videos_month_count: {
        Row: {
          month_start: string | null
          monthly_quota: number | null
          used: number | null
        }
        Relationships: []
      }
      morning_review_triage_active: {
        Row: {
          id: string | null
          item_kind: string | null
          item_ref: string | null
          note: string | null
          set_at: string | null
          set_by: string | null
          state: string | null
        }
        Insert: {
          id?: string | null
          item_kind?: string | null
          item_ref?: string | null
          note?: string | null
          set_at?: string | null
          set_by?: string | null
          state?: string | null
        }
        Update: {
          id?: string | null
          item_kind?: string | null
          item_ref?: string | null
          note?: string | null
          set_at?: string | null
          set_by?: string | null
          state?: string | null
        }
        Relationships: []
      }
      night_task_audit: {
        Row: {
          audit_complete: boolean | null
          discussion_action_id: string | null
          shift_id: string | null
          step_count: number | null
          steps: Json | null
          worst_severity: string | null
        }
        Relationships: [
          {
            foreignKeyName: "night_observations_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "night_shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      roadmap_phase_gate_status: {
        Row: {
          all_ok: boolean | null
          approvals_ok: boolean | null
          blockers: Json | null
          night_high_open: number | null
          night_ok: boolean | null
          open_tasks: number | null
          pending_signoffs: number | null
          phase_id: string | null
          phase_key: string | null
          phase_status: string | null
          qa_failed: number | null
          qa_ok: boolean | null
          qa_pass: number | null
          qa_total: number | null
          qa_unknown: number | null
          structural_ok: boolean | null
          total_tasks: number | null
        }
        Relationships: []
      }
      roadmap_task_outcome_health: {
        Row: {
          okr_kind: string | null
          okr_link_kind: string | null
          okr_node_id: string | null
          okr_status: string | null
          okr_title: string | null
          task_id: string | null
          task_key: string | null
          task_status: string | null
          task_title: string | null
        }
        Relationships: []
      }
      truth_conflicts: {
        Row: {
          entity: string | null
          entity_id: string | null
          field: string | null
          next_score: number | null
          next_source: string | null
          top_score: number | null
          top_source: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      acknowledge_all_triage_activity: { Args: never; Returns: number }
      acknowledge_triage_activity: { Args: { _id: string }; Returns: undefined }
      audit_security_definer_gating: {
        Args: never
        Returns: {
          arg_signature: string
          has_authz_check: boolean
          has_has_role: boolean
          has_not_authorized_raise: boolean
          has_uid_null_guard: boolean
          is_trigger: boolean
          proname: string
          source_preview: string
        }[]
      }
      auto_link_finding_to_action: {
        Args: { _finding_id: string }
        Returns: string
      }
      auto_purge_if_enabled: { Args: never; Returns: number }
      awip_rag_search: {
        Args: { _limit?: number; _q: string }
        Returns: {
          chunk_id: string
          content: string
          doc_id: string
          heading: string
          path: string
          rank: number
          title: string
        }[]
      }
      cancel_overnight_run: { Args: { _id: string }; Returns: undefined }
      db_analyze_public: { Args: never; Returns: undefined }
      db_list_all_columns: {
        Args: never
        Returns: {
          column_name: string
          data_type: string
          table_name: string
        }[]
      }
      db_list_columns: {
        Args: { _table: string }
        Returns: {
          column_default: string
          column_name: string
          data_type: string
          is_nullable: string
        }[]
      }
      db_list_tables: {
        Args: never
        Returns: {
          row_count: number
          size_bytes: number
          table_name: string
        }[]
      }
      db_preview_rows: {
        Args: { _limit?: number; _offset?: number; _table: string }
        Returns: Json
      }
      edge_function_health: {
        Args: { _hours?: number }
        Returns: {
          error_rate: number
          errors: number
          function_name: string
          last_error_at: string
          last_error_class: string
          last_error_message: string
          last_error_status: number
          p95_latency_ms: number
          total: number
        }[]
      }
      governance_chain: {
        Args: { _anchor_kind: string; _anchor_ref: string }
        Returns: Json
      }
      governance_coverage: { Args: { _days?: number }; Returns: Json }
      grant_user_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _target: string
        }
        Returns: undefined
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      infer_task_entity: {
        Args: { _module: string; _title: string }
        Returns: string
      }
      is_principal_allowed: {
        Args: { _platform: string; _principal: string }
        Returns: boolean
      }
      is_workstream_locked: { Args: { _workstream: string }; Returns: boolean }
      list_all_nightly_jobs: {
        Args: never
        Returns: {
          active: boolean
          category: string
          jobid: number
          jobname: string
          last_end: string
          last_start: string
          last_status: string
          schedule: string
        }[]
      }
      list_managed_cron_jobs: {
        Args: never
        Returns: {
          active: boolean
          jobid: number
          jobname: string
          last_end: string
          last_start: string
          last_status: string
          schedule: string
        }[]
      }
      list_users_with_roles: {
        Args: never
        Returns: {
          created_at: string
          email: string
          roles: Database["public"]["Enums"]["app_role"][]
          user_id: string
        }[]
      }
      purge_all_rows: { Args: { _table: string }; Returns: number }
      purge_expired_rows: {
        Args: { _table?: string }
        Returns: {
          deleted: number
          table_name: string
        }[]
      }
      reclaim_stale_night_jobs: {
        Args: { _stale_minutes?: number }
        Returns: Json
      }
      resolve_truth: {
        Args: { _entity: string; _entity_id: string; _field?: string }
        Returns: Json
      }
      retention_stats: {
        Args: never
        Returns: {
          oldest: string
          retention_days: number
          row_count: number
          table_name: string
        }[]
      }
      revoke_user_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _target: string
        }
        Returns: undefined
      }
      run_capability_sql_check: {
        Args: { _min_rows?: number; _sql: string }
        Returns: {
          ok: boolean
          row_count: number
        }[]
      }
      sentinel_triage_unacked_count: { Args: never; Returns: number }
      set_managed_cron_active: {
        Args: { _active: boolean; _jobname: string }
        Returns: undefined
      }
      sign_off_workstream: {
        Args: {
          _evidence: Json
          _notes?: string
          _overrides?: Json
          _workstream: string
        }
        Returns: Json
      }
      unlock_workstream: {
        Args: { _reason: string; _workstream: string }
        Returns: undefined
      }
      update_managed_cron_schedule: {
        Args: { _jobname: string; _schedule: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "operator" | "admin"
      capability_status: "available" | "planned" | "experimental" | "deprecated"
      notebook_kind: "thought" | "issue" | "research" | "suggestion" | "todo"
      notebook_status: "open" | "in_progress" | "resolved" | "archived"
      okr_creator: "discovery_ai" | "awip" | "human"
      okr_kind: "objective" | "key_result"
      okr_status: "draft" | "active" | "superseded" | "achieved" | "abandoned"
      plan_status: "todo" | "in_progress" | "blocked" | "done"
      roadmap_comment_kind: "comment" | "question" | "decision"
      roadmap_status: "planned" | "active" | "done" | "paused"
      roadmap_task_status:
        | "todo"
        | "in_progress"
        | "blocked"
        | "review"
        | "done"
        | "wont_do"
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
      notebook_kind: ["thought", "issue", "research", "suggestion", "todo"],
      notebook_status: ["open", "in_progress", "resolved", "archived"],
      okr_creator: ["discovery_ai", "awip", "human"],
      okr_kind: ["objective", "key_result"],
      okr_status: ["draft", "active", "superseded", "achieved", "abandoned"],
      plan_status: ["todo", "in_progress", "blocked", "done"],
      roadmap_comment_kind: ["comment", "question", "decision"],
      roadmap_status: ["planned", "active", "done", "paused"],
      roadmap_task_status: [
        "todo",
        "in_progress",
        "blocked",
        "review",
        "done",
        "wont_do",
      ],
    },
  },
} as const
