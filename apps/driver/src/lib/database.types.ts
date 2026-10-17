
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "allowance_types": {
                  Row: {
                    "active": boolean,"bills_allowed": boolean,"created_at": string,"default_amount_cents": number,"id": string,"name": string,"sort_order": number
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"bills_allowed"?: boolean,"created_at"?: string,"default_amount_cents"?: number,"id"?: string,"name": string,"sort_order"?: number
                  }
                  Update: {
                    "active"?: boolean,"bills_allowed"?: boolean,"created_at"?: string,"default_amount_cents"?: number,"id"?: string,"name"?: string,"sort_order"?: number
                  }
                  Relationships: [
                    
                  ]
                },"api_minute_calls": {
                  Row: {
                    "calls": number,"minute": string,"provider": string
                  }
                  ComputedFields: never
                  Insert: {
                    "calls"?: number,"minute": string,"provider": string
                  }
                  Update: {
                    "calls"?: number,"minute"?: string,"provider"?: string
                  }
                  Relationships: [
                    
                  ]
                },"claim_lines": {
                  Row: {
                    "allowance_type_id": string,"amount_cents": number,"claim_id": string,"id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "allowance_type_id": string,"amount_cents": number,"claim_id": string,"id"?: string
                  }
                  Update: {
                    "allowance_type_id"?: string,"amount_cents"?: number,"claim_id"?: string,"id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "claim_lines_allowance_type_id_fkey"
      columns: ["allowance_type_id"]
isOneToOne: false
      referencedRelation: "allowance_types"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "claim_lines_claim_id_fkey"
      columns: ["claim_id"]
isOneToOne: false
      referencedRelation: "claims"
      referencedColumns: ["id"]
    }
                  ]
                },"claim_sites": {
                  Row: {
                    "amount_cents": number | null,"claim_id": string,"hours": number | null,"id": string,"project_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents"?: number | null,"claim_id": string,"hours"?: number | null,"id"?: string,"project_id": string
                  }
                  Update: {
                    "amount_cents"?: number | null,"claim_id"?: string,"hours"?: number | null,"id"?: string,"project_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "claim_sites_claim_id_fkey"
      columns: ["claim_id"]
isOneToOne: false
      referencedRelation: "claims"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "claim_sites_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"claims": {
                  Row: {
                    "created_at": string,"decided_at": string | null,"decided_by": string | null,"employee_id": string,"id": string,"is_supplement": boolean,"reject_reason": string | null,"remarks": string | null,"split_method": string | null,"status": string,"submitted_at": string,"updated_at": string,"work_date": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"employee_id": string,"id"?: string,"is_supplement"?: boolean,"reject_reason"?: string | null,"remarks"?: string | null,"split_method"?: string | null,"status"?: string,"submitted_at"?: string,"updated_at"?: string,"work_date": string
                  }
                  Update: {
                    "created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"employee_id"?: string,"id"?: string,"is_supplement"?: boolean,"reject_reason"?: string | null,"remarks"?: string | null,"split_method"?: string | null,"status"?: string,"submitted_at"?: string,"updated_at"?: string,"work_date"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "claims_employee_id_fkey"
      columns: ["employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    }
                  ]
                },"device_tokens": {
                  Row: {
                    "app_version": string | null,"created_at": string,"device_model": string | null,"employee_id": string,"id": string,"language": string | null,"platform": string,"token": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "app_version"?: string | null,"created_at"?: string,"device_model"?: string | null,"employee_id": string,"id"?: string,"language"?: string | null,"platform"?: string,"token": string,"updated_at"?: string
                  }
                  Update: {
                    "app_version"?: string | null,"created_at"?: string,"device_model"?: string | null,"employee_id"?: string,"id"?: string,"language"?: string | null,"platform"?: string,"token"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "device_tokens_employee_id_fkey"
      columns: ["employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    }
                  ]
                },"driver_heartbeats": {
                  Row: {
                    "app_state": string | null,"app_version": string | null,"at": string,"battery_pct": number | null,"data_available": boolean | null,"dropped_accuracy": number | null,"dropped_duplicate": number | null,"dropped_jitter": number | null,"dropped_jump": number | null,"employee_id": string,"fixes_seen": number | null,"fixes_stored": number | null,"id": number,"last_gps_fix_age_s": number | null,"location_on": boolean | null,"location_restarts": number | null,"permission": string | null,"queued_points": number | null,"received_at": string,"rejected_points": number | null,"session_id": string | null,"sharing": boolean | null,"video_bytes_waiting": number | null,"video_uploads_waiting": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "app_state"?: string | null,"app_version"?: string | null,"at": string,"battery_pct"?: number | null,"data_available"?: boolean | null,"dropped_accuracy"?: number | null,"dropped_duplicate"?: number | null,"dropped_jitter"?: number | null,"dropped_jump"?: number | null,"employee_id": string,"fixes_seen"?: number | null,"fixes_stored"?: number | null,"id"?: never,"last_gps_fix_age_s"?: number | null,"location_on"?: boolean | null,"location_restarts"?: number | null,"permission"?: string | null,"queued_points"?: number | null,"received_at"?: string,"rejected_points"?: number | null,"session_id"?: string | null,"sharing"?: boolean | null,"video_bytes_waiting"?: number | null,"video_uploads_waiting"?: number | null
                  }
                  Update: {
                    "app_state"?: string | null,"app_version"?: string | null,"at"?: string,"battery_pct"?: number | null,"data_available"?: boolean | null,"dropped_accuracy"?: number | null,"dropped_duplicate"?: number | null,"dropped_jitter"?: number | null,"dropped_jump"?: number | null,"employee_id"?: string,"fixes_seen"?: number | null,"fixes_stored"?: number | null,"id"?: never,"last_gps_fix_age_s"?: number | null,"location_on"?: boolean | null,"location_restarts"?: number | null,"permission"?: string | null,"queued_points"?: number | null,"received_at"?: string,"rejected_points"?: number | null,"session_id"?: string | null,"sharing"?: boolean | null,"video_bytes_waiting"?: number | null,"video_uploads_waiting"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "driver_heartbeats_employee_id_fkey"
      columns: ["employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    }
                  ]
                },"driver_latest": {
                  Row: {
                    "accuracy_m": number | null,"battery_pct": number | null,"employee_id": string,"hb_app_state": string | null,"hb_app_version": string | null,"hb_at": string | null,"hb_battery_pct": number | null,"hb_data_available": boolean | null,"hb_fix_age_s": number | null,"hb_location_off_since": string | null,"hb_location_on": boolean | null,"hb_permission": string | null,"hb_queued_points": number | null,"hb_rejected_points": number | null,"hb_sharing": boolean | null,"hb_video_bytes_waiting": number | null,"hb_video_uploads_waiting": number | null,"heading": number | null,"lat": number | null,"lng": number | null,"recorded_at": string | null,"session_id": string | null,"sharing": boolean,"speed_mps": number | null,"watched_until": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "accuracy_m"?: number | null,"battery_pct"?: number | null,"employee_id": string,"hb_app_state"?: string | null,"hb_app_version"?: string | null,"hb_at"?: string | null,"hb_battery_pct"?: number | null,"hb_data_available"?: boolean | null,"hb_fix_age_s"?: number | null,"hb_location_off_since"?: string | null,"hb_location_on"?: boolean | null,"hb_permission"?: string | null,"hb_queued_points"?: number | null,"hb_rejected_points"?: number | null,"hb_sharing"?: boolean | null,"hb_video_bytes_waiting"?: number | null,"hb_video_uploads_waiting"?: number | null,"heading"?: number | null,"lat"?: number | null,"lng"?: number | null,"recorded_at"?: string | null,"session_id"?: string | null,"sharing"?: boolean,"speed_mps"?: number | null,"watched_until"?: string | null
                  }
                  Update: {
                    "accuracy_m"?: number | null,"battery_pct"?: number | null,"employee_id"?: string,"hb_app_state"?: string | null,"hb_app_version"?: string | null,"hb_at"?: string | null,"hb_battery_pct"?: number | null,"hb_data_available"?: boolean | null,"hb_fix_age_s"?: number | null,"hb_location_off_since"?: string | null,"hb_location_on"?: boolean | null,"hb_permission"?: string | null,"hb_queued_points"?: number | null,"hb_rejected_points"?: number | null,"hb_sharing"?: boolean | null,"hb_video_bytes_waiting"?: number | null,"hb_video_uploads_waiting"?: number | null,"heading"?: number | null,"lat"?: number | null,"lng"?: number | null,"recorded_at"?: string | null,"session_id"?: string | null,"sharing"?: boolean,"speed_mps"?: number | null,"watched_until"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "driver_latest_employee_id_fkey"
      columns: ["employee_id"]
isOneToOne: true
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "driver_latest_session_id_fkey"
      columns: ["session_id"]
isOneToOne: false
      referencedRelation: "duty_sessions"
      referencedColumns: ["id"]
    }
                  ]
                },"duty_sessions": {
                  Row: {
                    "device_info": Json | null,"employee_id": string,"end_reason": string | null,"ended_at": string | null,"id": string,"started_at": string,"vehicle_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "device_info"?: Json | null,"employee_id": string,"end_reason"?: string | null,"ended_at"?: string | null,"id"?: string,"started_at"?: string,"vehicle_id"?: string | null
                  }
                  Update: {
                    "device_info"?: Json | null,"employee_id"?: string,"end_reason"?: string | null,"ended_at"?: string | null,"id"?: string,"started_at"?: string,"vehicle_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "duty_sessions_employee_id_fkey"
      columns: ["employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "duty_sessions_vehicle_id_fkey"
      columns: ["vehicle_id"]
isOneToOne: false
      referencedRelation: "vehicles"
      referencedColumns: ["id"]
    }
                  ]
                },"employees": {
                  Row: {
                    "active": boolean,"auth_user_id": string | null,"code": string,"created_at": string,"current_vehicle_id": string | null,"email": string | null,"id": string,"language": string,"licence_expiry": string | null,"name": string,"permissions": (string)[],"phone": string | null,"photo_id": string | null,"photo_updated_at": string | null,"role": string,"updated_at": string,"username": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"auth_user_id"?: string | null,"code": string,"created_at"?: string,"current_vehicle_id"?: string | null,"email"?: string | null,"id"?: string,"language"?: string,"licence_expiry"?: string | null,"name": string,"permissions"?: (string)[],"phone"?: string | null,"photo_id"?: string | null,"photo_updated_at"?: string | null,"role"?: string,"updated_at"?: string,"username"?: string | null
                  }
                  Update: {
                    "active"?: boolean,"auth_user_id"?: string | null,"code"?: string,"created_at"?: string,"current_vehicle_id"?: string | null,"email"?: string | null,"id"?: string,"language"?: string,"licence_expiry"?: string | null,"name"?: string,"permissions"?: (string)[],"phone"?: string | null,"photo_id"?: string | null,"photo_updated_at"?: string | null,"role"?: string,"updated_at"?: string,"username"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "employees_current_vehicle_id_fkey"
      columns: ["current_vehicle_id"]
isOneToOne: false
      referencedRelation: "vehicles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "employees_photo_id_fkey"
      columns: ["photo_id"]
isOneToOne: false
      referencedRelation: "photos"
      referencedColumns: ["id"]
    }
                  ]
                },"fleet_settings": {
                  Row: {
                    "key": string,"updated_at": string,"updated_by": string | null,"value": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "key": string,"updated_at"?: string,"updated_by"?: string | null,"value": NonNullable<Json>
                  }
                  Update: {
                    "key"?: string,"updated_at"?: string,"updated_by"?: string | null,"value"?: NonNullable<Json>
                  }
                  Relationships: [
                    
                  ]
                },"fuel_logs": {
                  Row: {
                    "amount_cents": number | null,"employee_id": string,"id": string,"litres": number | null,"logged_at": string,"odometer_km": number | null,"receipt_photo_id": string | null,"task_id": string | null,"vehicle_id": string,"video_bytes": number | null,"video_checklist": Json | null,"video_duration_s": number | null,"video_interrupted": boolean,"video_path": string | null,"video_segments": Json | null,"video_status": string,"video_uploaded_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents"?: number | null,"employee_id": string,"id"?: string,"litres"?: number | null,"logged_at"?: string,"odometer_km"?: number | null,"receipt_photo_id"?: string | null,"task_id"?: string | null,"vehicle_id": string,"video_bytes"?: number | null,"video_checklist"?: Json | null,"video_duration_s"?: number | null,"video_interrupted"?: boolean,"video_path"?: string | null,"video_segments"?: Json | null,"video_status"?: string,"video_uploaded_at"?: string | null
                  }
                  Update: {
                    "amount_cents"?: number | null,"employee_id"?: string,"id"?: string,"litres"?: number | null,"logged_at"?: string,"odometer_km"?: number | null,"receipt_photo_id"?: string | null,"task_id"?: string | null,"vehicle_id"?: string,"video_bytes"?: number | null,"video_checklist"?: Json | null,"video_duration_s"?: number | null,"video_interrupted"?: boolean,"video_path"?: string | null,"video_segments"?: Json | null,"video_status"?: string,"video_uploaded_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "fuel_logs_employee_id_fkey"
      columns: ["employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fuel_logs_receipt_photo_id_fkey"
      columns: ["receipt_photo_id"]
isOneToOne: false
      referencedRelation: "photos"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fuel_logs_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fuel_logs_vehicle_id_fkey"
      columns: ["vehicle_id"]
isOneToOne: false
      referencedRelation: "vehicles"
      referencedColumns: ["id"]
    }
                  ]
                },"geocode_cache": {
                  Row: {
                    "answer": NonNullable<Json>,"fetched_at": string,"provider": string,"query": string
                  }
                  ComputedFields: never
                  Insert: {
                    "answer": NonNullable<Json>,"fetched_at"?: string,"provider": string,"query": string
                  }
                  Update: {
                    "answer"?: NonNullable<Json>,"fetched_at"?: string,"provider"?: string,"query"?: string
                  }
                  Relationships: [
                    
                  ]
                },"google_calls": {
                  Row: {
                    "calls": number,"day": string,"feature": string,"refused": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "calls"?: number,"day": string,"feature": string,"refused"?: number,"updated_at"?: string
                  }
                  Update: {
                    "calls"?: number,"day"?: string,"feature"?: string,"refused"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"google_pins": {
                  Row: {
                    "address": string | null,"district": string | null,"fetched_at": string,"google_place_id": string,"lat": number,"lng": number,"short_address": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"district"?: string | null,"fetched_at"?: string,"google_place_id": string,"lat": number,"lng": number,"short_address"?: string | null
                  }
                  Update: {
                    "address"?: string | null,"district"?: string | null,"fetched_at"?: string,"google_place_id"?: string,"lat"?: number,"lng"?: number,"short_address"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"issue_events": {
                  Row: {
                    "action": string,"actor": string | null,"actor_employee_id": string | null,"at": string,"from_status": string | null,"id": number,"issue_id": string,"note": string | null,"to_status": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor"?: string | null,"actor_employee_id"?: string | null,"at"?: string,"from_status"?: string | null,"id"?: never,"issue_id": string,"note"?: string | null,"to_status"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor"?: string | null,"actor_employee_id"?: string | null,"at"?: string,"from_status"?: string | null,"id"?: never,"issue_id"?: string,"note"?: string | null,"to_status"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "issue_events_actor_employee_id_fkey"
      columns: ["actor_employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "issue_events_issue_id_fkey"
      columns: ["issue_id"]
isOneToOne: false
      referencedRelation: "issues"
      referencedColumns: ["id"]
    }
                  ]
                },"issues": {
                  Row: {
                    "assigned_to": string | null,"auto": boolean,"detail": string | null,"due": string | null,"employee_id": string | null,"id": string,"kind": string,"opened_at": string,"ref_key": string,"request_id": string | null,"resolution_note": string | null,"resolved_at": string | null,"resolved_by": string | null,"severity": string,"sort_key": number,"status": string,"task_id": string | null,"title": string,"updated_at": string,"vehicle_id": string | null,"vehicle_report_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "assigned_to"?: string | null,"auto"?: boolean,"detail"?: string | null,"due"?: string | null,"employee_id"?: string | null,"id"?: string,"kind": string,"opened_at"?: string,"ref_key": string,"request_id"?: string | null,"resolution_note"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null,"severity": string,"sort_key"?: number,"status"?: string,"task_id"?: string | null,"title": string,"updated_at"?: string,"vehicle_id"?: string | null,"vehicle_report_id"?: string | null
                  }
                  Update: {
                    "assigned_to"?: string | null,"auto"?: boolean,"detail"?: string | null,"due"?: string | null,"employee_id"?: string | null,"id"?: string,"kind"?: string,"opened_at"?: string,"ref_key"?: string,"request_id"?: string | null,"resolution_note"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null,"severity"?: string,"sort_key"?: number,"status"?: string,"task_id"?: string | null,"title"?: string,"updated_at"?: string,"vehicle_id"?: string | null,"vehicle_report_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "issues_assigned_to_fkey"
      columns: ["assigned_to"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "issues_employee_id_fkey"
      columns: ["employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "issues_request_id_fkey"
      columns: ["request_id"]
isOneToOne: false
      referencedRelation: "vehicle_requests"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "issues_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "issues_vehicle_id_fkey"
      columns: ["vehicle_id"]
isOneToOne: false
      referencedRelation: "vehicles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "issues_vehicle_report_id_fkey"
      columns: ["vehicle_report_id"]
isOneToOne: false
      referencedRelation: "vehicle_reports"
      referencedColumns: ["id"]
    }
                  ]
                },"job_runs": {
                  Row: {
                    "finished_at": string | null,"job": string,"result": Json | null,"started_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "finished_at"?: string | null,"job": string,"result"?: Json | null,"started_at"?: string
                  }
                  Update: {
                    "finished_at"?: string | null,"job"?: string,"result"?: Json | null,"started_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"location_points": {
                  Row: {
                    "accuracy_m": number | null,"battery_pct": number | null,"employee_id": string,"heading": number | null,"id": number,"is_mock": boolean,"lat": number,"lng": number,"received_at": string,"recorded_at": string,"session_id": string,"source": string,"speed_mps": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "accuracy_m"?: number | null,"battery_pct"?: number | null,"employee_id": string,"heading"?: number | null,"id"?: never,"is_mock"?: boolean,"lat": number,"lng": number,"received_at"?: string,"recorded_at": string,"session_id": string,"source"?: string,"speed_mps"?: number | null
                  }
                  Update: {
                    "accuracy_m"?: number | null,"battery_pct"?: number | null,"employee_id"?: string,"heading"?: number | null,"id"?: never,"is_mock"?: boolean,"lat"?: number,"lng"?: number,"received_at"?: string,"recorded_at"?: string,"session_id"?: string,"source"?: string,"speed_mps"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "location_points_employee_id_fkey"
      columns: ["employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "location_points_session_id_fkey"
      columns: ["session_id"]
isOneToOne: false
      referencedRelation: "duty_sessions"
      referencedColumns: ["id"]
    }
                  ]
                },"media_links": {
                  Row: {
                    "bucket": string,"expires_at": string,"path": string,"url": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bucket": string,"expires_at": string,"path": string,"url": string
                  }
                  Update: {
                    "bucket"?: string,"expires_at"?: string,"path"?: string,"url"?: string
                  }
                  Relationships: [
                    
                  ]
                },"notification_settings": {
                  Row: {
                    "employee_id": string,"enabled": boolean,"event": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "employee_id": string,"enabled"?: boolean,"event": string,"updated_at"?: string
                  }
                  Update: {
                    "employee_id"?: string,"enabled"?: boolean,"event"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notification_settings_employee_id_fkey"
      columns: ["employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    }
                  ]
                },"notifications": {
                  Row: {
                    "attempts": number,"channel": string,"created_at": string,"error": string | null,"event": string,"id": number,"next_try_at": string,"payload": NonNullable<Json>,"recipient_employee_id": string,"sent_at": string | null,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"channel"?: string,"created_at"?: string,"error"?: string | null,"event": string,"id"?: never,"next_try_at"?: string,"payload": NonNullable<Json>,"recipient_employee_id": string,"sent_at"?: string | null,"status"?: string
                  }
                  Update: {
                    "attempts"?: number,"channel"?: string,"created_at"?: string,"error"?: string | null,"event"?: string,"id"?: never,"next_try_at"?: string,"payload"?: NonNullable<Json>,"recipient_employee_id"?: string,"sent_at"?: string | null,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notifications_recipient_employee_id_fkey"
      columns: ["recipient_employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    }
                  ]
                },"odometer_logs": {
                  Row: {
                    "ai_attempts": number,"ai_checked_at": string | null,"ai_status": string | null,"ai_value": number | null,"employee_id": string,"entry": string,"flag": string | null,"id": string,"kind": string,"logged_at": string,"ocr_value": number | null,"photo_attempts": number,"photo_id": string | null,"reading_km": number,"task_id": string | null,"vehicle_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "ai_attempts"?: number,"ai_checked_at"?: string | null,"ai_status"?: string | null,"ai_value"?: number | null,"employee_id": string,"entry"?: string,"flag"?: string | null,"id"?: string,"kind"?: string,"logged_at"?: string,"ocr_value"?: number | null,"photo_attempts"?: number,"photo_id"?: string | null,"reading_km": number,"task_id"?: string | null,"vehicle_id": string
                  }
                  Update: {
                    "ai_attempts"?: number,"ai_checked_at"?: string | null,"ai_status"?: string | null,"ai_value"?: number | null,"employee_id"?: string,"entry"?: string,"flag"?: string | null,"id"?: string,"kind"?: string,"logged_at"?: string,"ocr_value"?: number | null,"photo_attempts"?: number,"photo_id"?: string | null,"reading_km"?: number,"task_id"?: string | null,"vehicle_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "odometer_logs_employee_id_fkey"
      columns: ["employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "odometer_logs_photo_id_fkey"
      columns: ["photo_id"]
isOneToOne: false
      referencedRelation: "photos"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "odometer_logs_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "odometer_logs_vehicle_id_fkey"
      columns: ["vehicle_id"]
isOneToOne: false
      referencedRelation: "vehicles"
      referencedColumns: ["id"]
    }
                  ]
                },"odometer_reads": {
                  Row: {
                    "confidence": number | null,"created_at": string,"employee_id": string,"error": string | null,"gps_km": number | null,"id": number,"last_km": number | null,"log_id": string | null,"mode": string,"model": string,"ms": number | null,"ok": boolean,"photo_path": string,"raw": string | null,"reading_km": number | null,"status": string,"vehicle_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "confidence"?: number | null,"created_at"?: string,"employee_id": string,"error"?: string | null,"gps_km"?: number | null,"id"?: never,"last_km"?: number | null,"log_id"?: string | null,"mode"?: string,"model": string,"ms"?: number | null,"ok"?: boolean,"photo_path": string,"raw"?: string | null,"reading_km"?: number | null,"status"?: string,"vehicle_id"?: string | null
                  }
                  Update: {
                    "confidence"?: number | null,"created_at"?: string,"employee_id"?: string,"error"?: string | null,"gps_km"?: number | null,"id"?: never,"last_km"?: number | null,"log_id"?: string | null,"mode"?: string,"model"?: string,"ms"?: number | null,"ok"?: boolean,"photo_path"?: string,"raw"?: string | null,"reading_km"?: number | null,"status"?: string,"vehicle_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "odometer_reads_employee_id_fkey"
      columns: ["employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "odometer_reads_log_id_fkey"
      columns: ["log_id"]
isOneToOne: false
      referencedRelation: "odometer_logs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "odometer_reads_vehicle_id_fkey"
      columns: ["vehicle_id"]
isOneToOne: false
      referencedRelation: "vehicles"
      referencedColumns: ["id"]
    }
                  ]
                },"office_audit": {
                  Row: {
                    "actor_employee_id": string | null,"actor_name": string | null,"args_summary": string | null,"at": string,"channel": string,"id": number,"result_summary": string | null,"tool": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_employee_id"?: string | null,"actor_name"?: string | null,"args_summary"?: string | null,"at"?: string,"channel"?: string,"id"?: never,"result_summary"?: string | null,"tool": string
                  }
                  Update: {
                    "actor_employee_id"?: string | null,"actor_name"?: string | null,"args_summary"?: string | null,"at"?: string,"channel"?: string,"id"?: never,"result_summary"?: string | null,"tool"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "office_audit_actor_employee_id_fkey"
      columns: ["actor_employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    }
                  ]
                },"office_keys": {
                  Row: {
                    "created_at": string,"employee_id": string,"id": string,"key_hash": string,"label": string | null,"last_used_at": string | null,"revoked_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"employee_id": string,"id"?: string,"key_hash": string,"label"?: string | null,"last_used_at"?: string | null,"revoked_at"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"employee_id"?: string,"id"?: string,"key_hash"?: string,"label"?: string | null,"last_used_at"?: string | null,"revoked_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "office_keys_employee_id_fkey"
      columns: ["employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    }
                  ]
                },"photos": {
                  Row: {
                    "claim_line_id": string | null,"employee_id": string,"fuel_log_id": string | null,"id": string,"kind": string,"lat": number | null,"lng": number | null,"odometer_log_id": string | null,"storage_path": string,"taken_at": string,"vehicle_report_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "claim_line_id"?: string | null,"employee_id": string,"fuel_log_id"?: string | null,"id"?: string,"kind": string,"lat"?: number | null,"lng"?: number | null,"odometer_log_id"?: string | null,"storage_path": string,"taken_at"?: string,"vehicle_report_id"?: string | null
                  }
                  Update: {
                    "claim_line_id"?: string | null,"employee_id"?: string,"fuel_log_id"?: string | null,"id"?: string,"kind"?: string,"lat"?: number | null,"lng"?: number | null,"odometer_log_id"?: string | null,"storage_path"?: string,"taken_at"?: string,"vehicle_report_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "photos_claim_line_id_fkey"
      columns: ["claim_line_id"]
isOneToOne: false
      referencedRelation: "claim_lines"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "photos_employee_id_fkey"
      columns: ["employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "photos_fuel_log_id_fkey"
      columns: ["fuel_log_id"]
isOneToOne: false
      referencedRelation: "fuel_logs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "photos_odometer_log_id_fkey"
      columns: ["odometer_log_id"]
isOneToOne: false
      referencedRelation: "odometer_logs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "photos_vehicle_report_id_fkey"
      columns: ["vehicle_report_id"]
isOneToOne: false
      referencedRelation: "vehicle_reports"
      referencedColumns: ["id"]
    }
                  ]
                },"place_import_changes": {
                  Row: {
                    "action": string,"after_at": string,"before": Json | null,"id": number,"import_id": string,"place_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"after_at": string,"before"?: Json | null,"id"?: never,"import_id": string,"place_id": string
                  }
                  Update: {
                    "action"?: string,"after_at"?: string,"before"?: Json | null,"id"?: never,"import_id"?: string,"place_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "place_import_changes_import_id_fkey"
      columns: ["import_id"]
isOneToOne: false
      referencedRelation: "place_imports"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "place_import_changes_place_id_fkey"
      columns: ["place_id"]
isOneToOne: false
      referencedRelation: "places"
      referencedColumns: ["id"]
    }
                  ]
                },"place_imports": {
                  Row: {
                    "added": number,"at": string,"attached": number,"by_employee_id": string | null,"by_name": string,"file_name": string | null,"id": string,"no_pin": number,"preset_key": string,"preset_label": string | null,"rows": number,"skipped": number,"unchanged": number,"undo_result": Json | null,"undone_at": string | null,"undone_by": string | null,"updated": number
                  }
                  ComputedFields: never
                  Insert: {
                    "added"?: number,"at"?: string,"attached"?: number,"by_employee_id"?: string | null,"by_name": string,"file_name"?: string | null,"id"?: string,"no_pin"?: number,"preset_key": string,"preset_label"?: string | null,"rows"?: number,"skipped"?: number,"unchanged"?: number,"undo_result"?: Json | null,"undone_at"?: string | null,"undone_by"?: string | null,"updated"?: number
                  }
                  Update: {
                    "added"?: number,"at"?: string,"attached"?: number,"by_employee_id"?: string | null,"by_name"?: string,"file_name"?: string | null,"id"?: string,"no_pin"?: number,"preset_key"?: string,"preset_label"?: string | null,"rows"?: number,"skipped"?: number,"unchanged"?: number,"undo_result"?: Json | null,"undone_at"?: string | null,"undone_by"?: string | null,"updated"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "place_imports_by_employee_id_fkey"
      columns: ["by_employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    }
                  ]
                },"places": {
                  Row: {
                    "active": boolean,"address": string | null,"attribution": string | null,"created_at": string,"depot": string | null,"district": string | null,"id": string,"ids_text": string,"imported_at": string | null,"kind": string,"lat": number | null,"lng": number | null,"name": string,"operator": string,"other_ids": (string)[],"pin_source": string | null,"pinned": boolean | null,"provider_ref": string | null,"region": string | null,"site_id": string | null,"source": string,"updated_at": string,"usual_dwell_at": string | null,"usual_dwell_min": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"address"?: string | null,"attribution"?: string | null,"created_at"?: string,"depot"?: string | null,"district"?: string | null,"id"?: string,"ids_text"?: string,"imported_at"?: string | null,"kind"?: string,"lat"?: number | null,"lng"?: number | null,"name": string,"operator"?: string,"other_ids"?: (string)[],"pin_source"?: string | null,"pinned"?: never,"provider_ref"?: string | null,"region"?: string | null,"site_id"?: string | null,"source"?: string,"updated_at"?: string,"usual_dwell_at"?: string | null,"usual_dwell_min"?: number | null
                  }
                  Update: {
                    "active"?: boolean,"address"?: string | null,"attribution"?: string | null,"created_at"?: string,"depot"?: string | null,"district"?: string | null,"id"?: string,"ids_text"?: string,"imported_at"?: string | null,"kind"?: string,"lat"?: number | null,"lng"?: number | null,"name"?: string,"operator"?: string,"other_ids"?: (string)[],"pin_source"?: string | null,"pinned"?: never,"provider_ref"?: string | null,"region"?: string | null,"site_id"?: string | null,"source"?: string,"updated_at"?: string,"usual_dwell_at"?: string | null,"usual_dwell_min"?: number | null
                  }
                  Relationships: [
                    
                  ]
                },"projects": {
                  Row: {
                    "customer_id": string | null,"customer_name": string | null,"id": string,"job_no": string | null,"name": string,"short_name": string | null,"status": string | null,"updated_at": string,"zoho_project_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "customer_id"?: string | null,"customer_name"?: string | null,"id"?: string,"job_no"?: string | null,"name": string,"short_name"?: string | null,"status"?: string | null,"updated_at"?: string,"zoho_project_id": string
                  }
                  Update: {
                    "customer_id"?: string | null,"customer_name"?: string | null,"id"?: string,"job_no"?: string | null,"name"?: string,"short_name"?: string | null,"status"?: string | null,"updated_at"?: string,"zoho_project_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"push_log": {
                  Row: {
                    "created_at": string,"employee_id": string | null,"errors": Json | null,"failed": number,"id": number,"kind": string,"sent": number,"task_id": string | null,"tokens": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"employee_id"?: string | null,"errors"?: Json | null,"failed"?: number,"id"?: never,"kind": string,"sent"?: number,"task_id"?: string | null,"tokens"?: number
                  }
                  Update: {
                    "created_at"?: string,"employee_id"?: string | null,"errors"?: Json | null,"failed"?: number,"id"?: never,"kind"?: string,"sent"?: number,"task_id"?: string | null,"tokens"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "push_log_employee_id_fkey"
      columns: ["employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "push_log_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    }
                  ]
                },"rental_companies": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"phone": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"phone"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"phone"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"request_events": {
                  Row: {
                    "action": string,"actor": string | null,"at": string,"changes": Json | null,"id": number,"note": string | null,"request_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor"?: string | null,"at"?: string,"changes"?: Json | null,"id"?: never,"note"?: string | null,"request_id": string
                  }
                  Update: {
                    "action"?: string,"actor"?: string | null,"at"?: string,"changes"?: Json | null,"id"?: never,"note"?: string | null,"request_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "request_events_request_id_fkey"
      columns: ["request_id"]
isOneToOne: false
      referencedRelation: "vehicle_requests"
      referencedColumns: ["id"]
    }
                  ]
                },"request_stops": {
                  Row: {
                    "address": string | null,"arrive_by": string | null,"created_at": string,"dwell_min": number | null,"dwell_source": string | null,"google_fetched_at": string | null,"google_place_id": string | null,"id": string,"is_start": boolean,"lat": number | null,"lng": number | null,"note": string | null,"place_id": string | null,"place_name": string,"planned_arrive_at": string | null,"planned_depart_at": string | null,"removed_at": string | null,"request_id": string,"seq": number,"type": string,"what": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"arrive_by"?: string | null,"created_at"?: string,"dwell_min"?: number | null,"dwell_source"?: string | null,"google_fetched_at"?: string | null,"google_place_id"?: string | null,"id"?: string,"is_start"?: boolean,"lat"?: number | null,"lng"?: number | null,"note"?: string | null,"place_id"?: string | null,"place_name": string,"planned_arrive_at"?: string | null,"planned_depart_at"?: string | null,"removed_at"?: string | null,"request_id": string,"seq": number,"type": string,"what"?: string | null
                  }
                  Update: {
                    "address"?: string | null,"arrive_by"?: string | null,"created_at"?: string,"dwell_min"?: number | null,"dwell_source"?: string | null,"google_fetched_at"?: string | null,"google_place_id"?: string | null,"id"?: string,"is_start"?: boolean,"lat"?: number | null,"lng"?: number | null,"note"?: string | null,"place_id"?: string | null,"place_name"?: string,"planned_arrive_at"?: string | null,"planned_depart_at"?: string | null,"removed_at"?: string | null,"request_id"?: string,"seq"?: number,"type"?: string,"what"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "request_stops_place_id_fkey"
      columns: ["place_id"]
isOneToOne: false
      referencedRelation: "places"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "request_stops_request_id_fkey"
      columns: ["request_id"]
isOneToOne: false
      referencedRelation: "vehicle_requests"
      referencedColumns: ["id"]
    }
                  ]
                },"route_gap_lines": {
                  Row: {
                    "fetched_at": string,"from_lat": number,"from_lng": number,"geometry": NonNullable<Json>,"km": number | null,"provider": string,"to_lat": number,"to_lng": number
                  }
                  ComputedFields: never
                  Insert: {
                    "fetched_at"?: string,"from_lat": number,"from_lng": number,"geometry": NonNullable<Json>,"km"?: number | null,"provider"?: string,"to_lat": number,"to_lng": number
                  }
                  Update: {
                    "fetched_at"?: string,"from_lat"?: number,"from_lng"?: number,"geometry"?: NonNullable<Json>,"km"?: number | null,"provider"?: string,"to_lat"?: number,"to_lng"?: number
                  }
                  Relationships: [
                    
                  ]
                },"route_legs": {
                  Row: {
                    "avoid_expressway": boolean,"computed_at": string,"from_lat": number,"from_lng": number,"id": number,"km": number,"minutes": number,"provider": string,"to_lat": number,"to_lng": number,"via_expressway": boolean | null
                  }
                  ComputedFields: never
                  Insert: {
                    "avoid_expressway": boolean,"computed_at"?: string,"from_lat": number,"from_lng": number,"id"?: never,"km": number,"minutes": number,"provider": string,"to_lat": number,"to_lng": number,"via_expressway"?: boolean | null
                  }
                  Update: {
                    "avoid_expressway"?: boolean,"computed_at"?: string,"from_lat"?: number,"from_lng"?: number,"id"?: never,"km"?: number,"minutes"?: number,"provider"?: string,"to_lat"?: number,"to_lng"?: number,"via_expressway"?: boolean | null
                  }
                  Relationships: [
                    
                  ]
                },"route_matched": {
                  Row: {
                    "date": string,"employee_id": string,"error": string | null,"geometry": NonNullable<Json>,"id": number,"leg_from": string,"leg_to": string,"matched_at": string,"provider": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "date": string,"employee_id": string,"error"?: string | null,"geometry"?: NonNullable<Json>,"id"?: never,"leg_from": string,"leg_to": string,"matched_at"?: string,"provider": string,"status"?: string
                  }
                  Update: {
                    "date"?: string,"employee_id"?: string,"error"?: string | null,"geometry"?: NonNullable<Json>,"id"?: never,"leg_from"?: string,"leg_to"?: string,"matched_at"?: string,"provider"?: string,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "route_matched_employee_id_fkey"
      columns: ["employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    }
                  ]
                },"routing_calls": {
                  Row: {
                    "calls": number,"day": string,"errors": number,"provider": string
                  }
                  ComputedFields: never
                  Insert: {
                    "calls"?: number,"day": string,"errors"?: number,"provider": string
                  }
                  Update: {
                    "calls"?: number,"day"?: string,"errors"?: number,"provider"?: string
                  }
                  Relationships: [
                    
                  ]
                },"site_import_presets": {
                  Row: {
                    "created_at": string,"created_by": string,"id": string,"mapping": NonNullable<Json>,"name": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by": string,"id"?: string,"mapping": NonNullable<Json>,"name": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string,"id"?: string,"mapping"?: NonNullable<Json>,"name"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"task_assignment_events": {
                  Row: {
                    "action": string,"actor": string | null,"at": string,"changes": Json | null,"employee_id": string | null,"id": number,"note": string | null,"task_id": string,"vehicle_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor"?: string | null,"at"?: string,"changes"?: Json | null,"employee_id"?: string | null,"id"?: never,"note"?: string | null,"task_id": string,"vehicle_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor"?: string | null,"at"?: string,"changes"?: Json | null,"employee_id"?: string | null,"id"?: never,"note"?: string | null,"task_id"?: string,"vehicle_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "task_assignment_events_employee_id_fkey"
      columns: ["employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_assignment_events_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_assignment_events_vehicle_id_fkey"
      columns: ["vehicle_id"]
isOneToOne: false
      referencedRelation: "vehicles"
      referencedColumns: ["id"]
    }
                  ]
                },"task_eta": {
                  Row: {
                    "computed_at": string,"final_eta_at": string | null,"late_min": number | null,"next_eta_at": string | null,"next_seq": number | null,"source": string | null,"task_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "computed_at": string,"final_eta_at"?: string | null,"late_min"?: number | null,"next_eta_at"?: string | null,"next_seq"?: number | null,"source"?: string | null,"task_id": string
                  }
                  Update: {
                    "computed_at"?: string,"final_eta_at"?: string | null,"late_min"?: number | null,"next_eta_at"?: string | null,"next_seq"?: number | null,"source"?: string | null,"task_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "task_eta_task_id_fkey"
      columns: ["task_id"]
isOneToOne: true
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    }
                  ]
                },"task_projects": {
                  Row: {
                    "id": string,"percent": number,"project_id": string | null,"task_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"percent": number,"project_id"?: string | null,"task_id": string
                  }
                  Update: {
                    "id"?: string,"percent"?: number,"project_id"?: string | null,"task_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "task_projects_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_projects_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    }
                  ]
                },"task_stops": {
                  Row: {
                    "address": string | null,"arrival_accuracy_m": number | null,"arrival_at": string | null,"arrival_distance_m": number | null,"arrival_flag": string | null,"arrival_lat": number | null,"arrival_lng": number | null,"arrive_by": string | null,"arrived_at": string | null,"auto_detected_at": string | null,"done_at": string | null,"dwell_min": number | null,"dwell_source": string | null,"google_fetched_at": string | null,"google_place_id": string | null,"id": string,"is_start": boolean,"lat": number | null,"lng": number | null,"note": string | null,"place_id": string | null,"place_name": string,"planned_arrive_at": string | null,"planned_depart_at": string | null,"removed_at": string | null,"saved_place_id": string | null,"seq": number,"skip_note": string | null,"skip_reason": string | null,"status": string,"task_id": string,"type": string,"what": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"arrival_accuracy_m"?: number | null,"arrival_at"?: string | null,"arrival_distance_m"?: number | null,"arrival_flag"?: string | null,"arrival_lat"?: number | null,"arrival_lng"?: number | null,"arrive_by"?: string | null,"arrived_at"?: string | null,"auto_detected_at"?: string | null,"done_at"?: string | null,"dwell_min"?: number | null,"dwell_source"?: string | null,"google_fetched_at"?: string | null,"google_place_id"?: string | null,"id"?: string,"is_start"?: boolean,"lat"?: number | null,"lng"?: number | null,"note"?: string | null,"place_id"?: string | null,"place_name": string,"planned_arrive_at"?: string | null,"planned_depart_at"?: string | null,"removed_at"?: string | null,"saved_place_id"?: string | null,"seq": number,"skip_note"?: string | null,"skip_reason"?: string | null,"status"?: string,"task_id": string,"type": string,"what"?: string | null
                  }
                  Update: {
                    "address"?: string | null,"arrival_accuracy_m"?: number | null,"arrival_at"?: string | null,"arrival_distance_m"?: number | null,"arrival_flag"?: string | null,"arrival_lat"?: number | null,"arrival_lng"?: number | null,"arrive_by"?: string | null,"arrived_at"?: string | null,"auto_detected_at"?: string | null,"done_at"?: string | null,"dwell_min"?: number | null,"dwell_source"?: string | null,"google_fetched_at"?: string | null,"google_place_id"?: string | null,"id"?: string,"is_start"?: boolean,"lat"?: number | null,"lng"?: number | null,"note"?: string | null,"place_id"?: string | null,"place_name"?: string,"planned_arrive_at"?: string | null,"planned_depart_at"?: string | null,"removed_at"?: string | null,"saved_place_id"?: string | null,"seq"?: number,"skip_note"?: string | null,"skip_reason"?: string | null,"status"?: string,"task_id"?: string,"type"?: string,"what"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "task_stops_place_id_fkey"
      columns: ["place_id"]
isOneToOne: false
      referencedRelation: "places"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_stops_saved_place_id_fkey"
      columns: ["saved_place_id"]
isOneToOne: false
      referencedRelation: "places"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_stops_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    }
                  ]
                },"task_vehicle_segments": {
                  Row: {
                    "by_name": string | null,"created_at": string,"end_odometer_km": number | null,"from_at": string,"id": string,"reason": string | null,"seq": number,"start_odometer_km": number | null,"task_id": string,"to_at": string | null,"vehicle_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "by_name"?: string | null,"created_at"?: string,"end_odometer_km"?: number | null,"from_at": string,"id"?: string,"reason"?: string | null,"seq": number,"start_odometer_km"?: number | null,"task_id": string,"to_at"?: string | null,"vehicle_id": string
                  }
                  Update: {
                    "by_name"?: string | null,"created_at"?: string,"end_odometer_km"?: number | null,"from_at"?: string,"id"?: string,"reason"?: string | null,"seq"?: number,"start_odometer_km"?: number | null,"task_id"?: string,"to_at"?: string | null,"vehicle_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "task_vehicle_segments_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_vehicle_segments_vehicle_id_fkey"
      columns: ["vehicle_id"]
isOneToOne: false
      referencedRelation: "vehicles"
      referencedColumns: ["id"]
    }
                  ]
                },"tasks": {
                  Row: {
                    "accept_reminder_sent_at": string | null,"accepted_at": string | null,"assigned_by_employee_id": string | null,"avoid_expressway": boolean,"buffer_min": number | null,"cancelled_reason": string | null,"completed_at": string | null,"contact_name": string | null,"contact_phone": string | null,"created_at": string,"created_by": string | null,"declined_after_accept": boolean,"declined_at": string | null,"declined_by": string | null,"declined_note": string | null,"declined_reason": string | null,"employee_id": string,"end_by": string | null,"end_odometer_km": number | null,"finish_flag": Json | null,"id": string,"km": number | null,"label": string | null,"leave_by": string | null,"leave_by_source": string | null,"needs_driver_reason": string | null,"needs_driver_since": string | null,"notes": string | null,"passengers": number | null,"plan_json": Json | null,"plan_version": number,"reminder_0_sent_at": string | null,"reminder_30_sent_at": string | null,"request_id": string | null,"return_to_base": boolean,"seen_at": string | null,"sent_at": string,"start_at": string,"start_google_fetched_at": string | null,"start_google_place_id": string | null,"start_lat": number | null,"start_lng": number | null,"start_name": string | null,"start_odometer_km": number | null,"start_place_id": string | null,"started_at": string | null,"status": string,"title": string,"updated_at": string,"vehicle_choice": Json | null,"vehicle_id": string,"warnings": Json | null
                  }
                  ComputedFields: never
                  Insert: {
                    "accept_reminder_sent_at"?: string | null,"accepted_at"?: string | null,"assigned_by_employee_id"?: string | null,"avoid_expressway"?: boolean,"buffer_min"?: number | null,"cancelled_reason"?: string | null,"completed_at"?: string | null,"contact_name"?: string | null,"contact_phone"?: string | null,"created_at"?: string,"created_by"?: string | null,"declined_after_accept"?: boolean,"declined_at"?: string | null,"declined_by"?: string | null,"declined_note"?: string | null,"declined_reason"?: string | null,"employee_id": string,"end_by"?: string | null,"end_odometer_km"?: number | null,"finish_flag"?: Json | null,"id"?: string,"km"?: number | null,"label"?: string | null,"leave_by"?: string | null,"leave_by_source"?: string | null,"needs_driver_reason"?: string | null,"needs_driver_since"?: string | null,"notes"?: string | null,"passengers"?: number | null,"plan_json"?: Json | null,"plan_version"?: number,"reminder_0_sent_at"?: string | null,"reminder_30_sent_at"?: string | null,"request_id"?: string | null,"return_to_base"?: boolean,"seen_at"?: string | null,"sent_at"?: string,"start_at": string,"start_google_fetched_at"?: string | null,"start_google_place_id"?: string | null,"start_lat"?: number | null,"start_lng"?: number | null,"start_name"?: string | null,"start_odometer_km"?: number | null,"start_place_id"?: string | null,"started_at"?: string | null,"status"?: string,"title": string,"updated_at"?: string,"vehicle_choice"?: Json | null,"vehicle_id": string,"warnings"?: Json | null
                  }
                  Update: {
                    "accept_reminder_sent_at"?: string | null,"accepted_at"?: string | null,"assigned_by_employee_id"?: string | null,"avoid_expressway"?: boolean,"buffer_min"?: number | null,"cancelled_reason"?: string | null,"completed_at"?: string | null,"contact_name"?: string | null,"contact_phone"?: string | null,"created_at"?: string,"created_by"?: string | null,"declined_after_accept"?: boolean,"declined_at"?: string | null,"declined_by"?: string | null,"declined_note"?: string | null,"declined_reason"?: string | null,"employee_id"?: string,"end_by"?: string | null,"end_odometer_km"?: number | null,"finish_flag"?: Json | null,"id"?: string,"km"?: number | null,"label"?: string | null,"leave_by"?: string | null,"leave_by_source"?: string | null,"needs_driver_reason"?: string | null,"needs_driver_since"?: string | null,"notes"?: string | null,"passengers"?: number | null,"plan_json"?: Json | null,"plan_version"?: number,"reminder_0_sent_at"?: string | null,"reminder_30_sent_at"?: string | null,"request_id"?: string | null,"return_to_base"?: boolean,"seen_at"?: string | null,"sent_at"?: string,"start_at"?: string,"start_google_fetched_at"?: string | null,"start_google_place_id"?: string | null,"start_lat"?: number | null,"start_lng"?: number | null,"start_name"?: string | null,"start_odometer_km"?: number | null,"start_place_id"?: string | null,"started_at"?: string | null,"status"?: string,"title"?: string,"updated_at"?: string,"vehicle_choice"?: Json | null,"vehicle_id"?: string,"warnings"?: Json | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "tasks_assigned_by_employee_id_fkey"
      columns: ["assigned_by_employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_declined_by_fkey"
      columns: ["declined_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_employee_id_fkey"
      columns: ["employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_request_id_fkey"
      columns: ["request_id"]
isOneToOne: false
      referencedRelation: "vehicle_requests"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_start_place_id_fkey"
      columns: ["start_place_id"]
isOneToOne: false
      referencedRelation: "places"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_vehicle_id_fkey"
      columns: ["vehicle_id"]
isOneToOne: false
      referencedRelation: "vehicles"
      referencedColumns: ["id"]
    }
                  ]
                },"towns": {
                  Row: {
                    "id": number,"lat": number,"lng": number,"name": string,"population": number
                  }
                  ComputedFields: never
                  Insert: {
                    "id": number,"lat": number,"lng": number,"name": string,"population"?: number
                  }
                  Update: {
                    "id"?: number,"lat"?: number,"lng"?: number,"name"?: string,"population"?: number
                  }
                  Relationships: [
                    
                  ]
                },"vehicle_assignments": {
                  Row: {
                    "by_name": string,"client_id": string | null,"created_at": string,"employee_id": string,"ended_by_name": string | null,"ended_how": string | null,"from_at": string,"how": string,"id": string,"task_id": string | null,"to_at": string | null,"vehicle_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "by_name": string,"client_id"?: string | null,"created_at"?: string,"employee_id": string,"ended_by_name"?: string | null,"ended_how"?: string | null,"from_at": string,"how": string,"id"?: string,"task_id"?: string | null,"to_at"?: string | null,"vehicle_id": string
                  }
                  Update: {
                    "by_name"?: string,"client_id"?: string | null,"created_at"?: string,"employee_id"?: string,"ended_by_name"?: string | null,"ended_how"?: string | null,"from_at"?: string,"how"?: string,"id"?: string,"task_id"?: string | null,"to_at"?: string | null,"vehicle_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "vehicle_assignments_employee_id_fkey"
      columns: ["employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "vehicle_assignments_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "vehicle_assignments_vehicle_id_fkey"
      columns: ["vehicle_id"]
isOneToOne: false
      referencedRelation: "vehicles"
      referencedColumns: ["id"]
    }
                  ]
                },"vehicle_documents": {
                  Row: {
                    "bytes": number | null,"content_type": string,"expiry": string | null,"id": string,"kind": string,"name": string | null,"path": string,"removed_at": string | null,"removed_by": string | null,"removed_reason": string | null,"uploaded_at": string,"uploaded_by": string | null,"uploaded_by_name": string | null,"vehicle_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bytes"?: number | null,"content_type": string,"expiry"?: string | null,"id"?: string,"kind": string,"name"?: string | null,"path": string,"removed_at"?: string | null,"removed_by"?: string | null,"removed_reason"?: string | null,"uploaded_at"?: string,"uploaded_by"?: string | null,"uploaded_by_name"?: string | null,"vehicle_id": string
                  }
                  Update: {
                    "bytes"?: number | null,"content_type"?: string,"expiry"?: string | null,"id"?: string,"kind"?: string,"name"?: string | null,"path"?: string,"removed_at"?: string | null,"removed_by"?: string | null,"removed_reason"?: string | null,"uploaded_at"?: string,"uploaded_by"?: string | null,"uploaded_by_name"?: string | null,"vehicle_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "vehicle_documents_uploaded_by_fkey"
      columns: ["uploaded_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "vehicle_documents_vehicle_id_fkey"
      columns: ["vehicle_id"]
isOneToOne: false
      referencedRelation: "vehicles"
      referencedColumns: ["id"]
    }
                  ]
                },"vehicle_reports": {
                  Row: {
                    "category": string,"closed_at": string | null,"created_at": string,"employee_id": string,"id": string,"needs_vehicle": boolean,"note": string | null,"office_note": string | null,"status": string,"task_id": string | null,"vehicle_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "category": string,"closed_at"?: string | null,"created_at"?: string,"employee_id": string,"id"?: string,"needs_vehicle"?: boolean,"note"?: string | null,"office_note"?: string | null,"status"?: string,"task_id"?: string | null,"vehicle_id": string
                  }
                  Update: {
                    "category"?: string,"closed_at"?: string | null,"created_at"?: string,"employee_id"?: string,"id"?: string,"needs_vehicle"?: boolean,"note"?: string | null,"office_note"?: string | null,"status"?: string,"task_id"?: string | null,"vehicle_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "vehicle_reports_employee_id_fkey"
      columns: ["employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "vehicle_reports_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "vehicle_reports_vehicle_id_fkey"
      columns: ["vehicle_id"]
isOneToOne: false
      referencedRelation: "vehicles"
      referencedColumns: ["id"]
    }
                  ]
                },"vehicle_requests": {
                  Row: {
                    "arrived_push_sent_at": string | null,"avoid_expressway": boolean,"back_by": string | null,"buffer_min": number | null,"cancel_reason": string | null,"cancelled_at": string | null,"cancelled_by": string | null,"change_note": string | null,"changed_at": string | null,"changed_by": string | null,"contact_name": string | null,"contact_phone": string | null,"created_at": string,"decide_reminder_sent_at": string | null,"decided_at": string | null,"decided_by": string | null,"decline_reason": string | null,"driver_required": boolean,"from_dwell_min": number | null,"id": string,"kind": string,"label": string | null,"late_push_sent_at": string | null,"leave_by": string | null,"leave_by_source": string | null,"need_type": string | null,"needed_at": string,"note": string | null,"on_behalf_of": string | null,"one_step": boolean,"pax": number | null,"plan_json": Json | null,"previous": Json | null,"project_id": string | null,"project_label": string | null,"projects_json": Json | null,"proposal_json": Json | null,"proposed_employee_id": string | null,"proposed_vehicle_id": string | null,"requested_by_employee_id": string | null,"requested_by_name": string,"requested_by_user_id": string | null,"requester_phone": string | null,"return_to_base": boolean,"route_from": string | null,"route_to": string | null,"seen_at": string | null,"seen_by": string | null,"start_google_fetched_at": string | null,"start_google_place_id": string | null,"start_lat": number | null,"start_lng": number | null,"start_name": string | null,"start_place_id": string | null,"status": string,"task_id": string | null,"task_notes": string | null,"title": string | null,"to_dwell_min": number | null,"tools": boolean,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "arrived_push_sent_at"?: string | null,"avoid_expressway"?: boolean,"back_by"?: string | null,"buffer_min"?: number | null,"cancel_reason"?: string | null,"cancelled_at"?: string | null,"cancelled_by"?: string | null,"change_note"?: string | null,"changed_at"?: string | null,"changed_by"?: string | null,"contact_name"?: string | null,"contact_phone"?: string | null,"created_at"?: string,"decide_reminder_sent_at"?: string | null,"decided_at"?: string | null,"decided_by"?: string | null,"decline_reason"?: string | null,"driver_required"?: boolean,"from_dwell_min"?: number | null,"id"?: string,"kind"?: string,"label"?: string | null,"late_push_sent_at"?: string | null,"leave_by"?: string | null,"leave_by_source"?: string | null,"need_type"?: string | null,"needed_at": string,"note"?: string | null,"on_behalf_of"?: string | null,"one_step"?: boolean,"pax"?: number | null,"plan_json"?: Json | null,"previous"?: Json | null,"project_id"?: string | null,"project_label"?: string | null,"projects_json"?: Json | null,"proposal_json"?: Json | null,"proposed_employee_id"?: string | null,"proposed_vehicle_id"?: string | null,"requested_by_employee_id"?: string | null,"requested_by_name": string,"requested_by_user_id"?: string | null,"requester_phone"?: string | null,"return_to_base"?: boolean,"route_from"?: string | null,"route_to"?: string | null,"seen_at"?: string | null,"seen_by"?: string | null,"start_google_fetched_at"?: string | null,"start_google_place_id"?: string | null,"start_lat"?: number | null,"start_lng"?: number | null,"start_name"?: string | null,"start_place_id"?: string | null,"status"?: string,"task_id"?: string | null,"task_notes"?: string | null,"title"?: string | null,"to_dwell_min"?: number | null,"tools"?: boolean,"version"?: number
                  }
                  Update: {
                    "arrived_push_sent_at"?: string | null,"avoid_expressway"?: boolean,"back_by"?: string | null,"buffer_min"?: number | null,"cancel_reason"?: string | null,"cancelled_at"?: string | null,"cancelled_by"?: string | null,"change_note"?: string | null,"changed_at"?: string | null,"changed_by"?: string | null,"contact_name"?: string | null,"contact_phone"?: string | null,"created_at"?: string,"decide_reminder_sent_at"?: string | null,"decided_at"?: string | null,"decided_by"?: string | null,"decline_reason"?: string | null,"driver_required"?: boolean,"from_dwell_min"?: number | null,"id"?: string,"kind"?: string,"label"?: string | null,"late_push_sent_at"?: string | null,"leave_by"?: string | null,"leave_by_source"?: string | null,"need_type"?: string | null,"needed_at"?: string,"note"?: string | null,"on_behalf_of"?: string | null,"one_step"?: boolean,"pax"?: number | null,"plan_json"?: Json | null,"previous"?: Json | null,"project_id"?: string | null,"project_label"?: string | null,"projects_json"?: Json | null,"proposal_json"?: Json | null,"proposed_employee_id"?: string | null,"proposed_vehicle_id"?: string | null,"requested_by_employee_id"?: string | null,"requested_by_name"?: string,"requested_by_user_id"?: string | null,"requester_phone"?: string | null,"return_to_base"?: boolean,"route_from"?: string | null,"route_to"?: string | null,"seen_at"?: string | null,"seen_by"?: string | null,"start_google_fetched_at"?: string | null,"start_google_place_id"?: string | null,"start_lat"?: number | null,"start_lng"?: number | null,"start_name"?: string | null,"start_place_id"?: string | null,"status"?: string,"task_id"?: string | null,"task_notes"?: string | null,"title"?: string | null,"to_dwell_min"?: number | null,"tools"?: boolean,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "vehicle_requests_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "vehicle_requests_proposed_employee_id_fkey"
      columns: ["proposed_employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "vehicle_requests_proposed_vehicle_id_fkey"
      columns: ["proposed_vehicle_id"]
isOneToOne: false
      referencedRelation: "vehicles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "vehicle_requests_requested_by_employee_id_fkey"
      columns: ["requested_by_employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "vehicle_requests_start_place_id_fkey"
      columns: ["start_place_id"]
isOneToOne: false
      referencedRelation: "places"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "vehicle_requests_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    }
                  ]
                },"vehicles": {
                  Row: {
                    "active": boolean,"created_at": string,"current_odometer_km": number | null,"custodian_employee_id": string | null,"custodian_note": string | null,"emission_expiry": string | null,"garage_booked_date": string | null,"id": string,"in_garage": boolean,"insurance_expiry": string | null,"last_service_odometer_km": number | null,"licence_expiry": string | null,"make_model": string | null,"monthly_km_allowance": number | null,"monthly_rent_cents": number | null,"next_service_date": string | null,"photo_path": string | null,"photo_thumb_path": string | null,"photo_updated_at": string | null,"reg_no": string,"regular_driver_id": string | null,"rent_until": string | null,"rental_company_id": string | null,"seats": number | null,"service_interval_km": number | null,"updated_at": string,"vehicle_type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"current_odometer_km"?: number | null,"custodian_employee_id"?: string | null,"custodian_note"?: string | null,"emission_expiry"?: string | null,"garage_booked_date"?: string | null,"id"?: string,"in_garage"?: boolean,"insurance_expiry"?: string | null,"last_service_odometer_km"?: number | null,"licence_expiry"?: string | null,"make_model"?: string | null,"monthly_km_allowance"?: number | null,"monthly_rent_cents"?: number | null,"next_service_date"?: string | null,"photo_path"?: string | null,"photo_thumb_path"?: string | null,"photo_updated_at"?: string | null,"reg_no": string,"regular_driver_id"?: string | null,"rent_until"?: string | null,"rental_company_id"?: string | null,"seats"?: number | null,"service_interval_km"?: number | null,"updated_at"?: string,"vehicle_type"?: string
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"current_odometer_km"?: number | null,"custodian_employee_id"?: string | null,"custodian_note"?: string | null,"emission_expiry"?: string | null,"garage_booked_date"?: string | null,"id"?: string,"in_garage"?: boolean,"insurance_expiry"?: string | null,"last_service_odometer_km"?: number | null,"licence_expiry"?: string | null,"make_model"?: string | null,"monthly_km_allowance"?: number | null,"monthly_rent_cents"?: number | null,"next_service_date"?: string | null,"photo_path"?: string | null,"photo_thumb_path"?: string | null,"photo_updated_at"?: string | null,"reg_no"?: string,"regular_driver_id"?: string | null,"rent_until"?: string | null,"rental_company_id"?: string | null,"seats"?: number | null,"service_interval_km"?: number | null,"updated_at"?: string,"vehicle_type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "vehicles_custodian_employee_id_fkey"
      columns: ["custodian_employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "vehicles_regular_driver_id_fkey"
      columns: ["regular_driver_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "vehicles_rental_company_id_fkey"
      columns: ["rental_company_id"]
isOneToOne: false
      referencedRelation: "rental_companies"
      referencedColumns: ["id"]
    }
                  ]
                },"web_push_subscriptions": {
                  Row: {
                    "auth": string,"created_at": string,"employee_id": string,"endpoint": string,"id": string,"last_ok_at": string | null,"p256dh": string,"removed_at": string | null,"removed_reason": string | null,"user_agent": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "auth": string,"created_at"?: string,"employee_id": string,"endpoint": string,"id"?: string,"last_ok_at"?: string | null,"p256dh": string,"removed_at"?: string | null,"removed_reason"?: string | null,"user_agent"?: string | null
                  }
                  Update: {
                    "auth"?: string,"created_at"?: string,"employee_id"?: string,"endpoint"?: string,"id"?: string,"last_ok_at"?: string | null,"p256dh"?: string,"removed_at"?: string | null,"removed_reason"?: string | null,"user_agent"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "web_push_subscriptions_employee_id_fkey"
      columns: ["employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "accept_task":
{ Args: { "p_at"?: string,"p_task_id": string }; Returns: string
                           },
"app_stops":
{ Args: { "p_from": string,"p_to": string }; Returns: {
              "employee_id": string,"last_stop_at": string,"stops": number
            }[]
                           },
"approve_recipients":
{ Args: Record<PropertyKey, never>; Returns: (string)[]
                           },
"bump_minute_calls":
{ Args: { "p_provider": string }; Returns: number
                           },
"bump_routing_calls":
{ Args: { "p_ok": boolean,"p_provider": string }; Returns: undefined
                           },
"call_edge_function":
{ Args: { "p_body": Json,"p_name": string }; Returns: undefined
                           },
"change_vehicle":
{ Args: { "p_at": string,"p_client": string,"p_vehicle": string }; Returns: Json
                           },
"colombo_when":
{ Args: { "p_at": string }; Returns: string
                           },
"current_employee_id":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"current_office_role":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"decline_task":
{ Args: { "p_at"?: string,"p_note"?: string,"p_reason": string,"p_task_id": string }; Returns: string
                           },
"dispatch_recipients":
{ Args: Record<PropertyKey, never>; Returns: (string)[]
                           },
"duty_cutoff_after":
{ Args: { "p_at": string,"p_cutoff": string }; Returns: string
                           },
"duty_jobs":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"fill_stop_arrivals":
{ Args: { "p_days"?: number }; Returns: number
                           },
"fleet_sync":
{ Args: { "p_scope"?: Json }; Returns: undefined
                           },
"get_driver_settings":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"google_hard_ceiling":
{ Args: { "p_feature": string }; Returns: number
                           },
"google_take":
{ Args: { "p_day_cap": number,"p_feature": string,"p_month_cap": number }; Returns: Json
                           },
"import_place_rows":
{ Args: { "p_attach_m"?: number,"p_import_id"?: string,"p_preset": string,"p_rows": Json }; Returns: Json
                           },
"issue_visible":
{ Args: { "p_kind": string }; Returns: boolean
                           },
"my_held_vehicle":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"my_vehicle_choices":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"nearest_town_name":
{ Args: { "p_lat": number,"p_lng": number }; Returns: string
                           },
"notify_needs_driver":
{ Args: { "p_body": string,"p_task": string,"p_title": string }; Returns: undefined
                           },
"notify_requester":
{ Args: { "p_body": string,"p_event": string,"p_task": string,"p_title": string }; Returns: undefined
                           },
"notify_retry":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"odometer_log_flag":
{ Args: { "p_ai_status": string,"p_ai_value": number,"p_entry": string,"p_reading": number }; Returns: string
                           },
"office_book_vehicle":
{ Args: { "p_decided_by"?: string,"p_projects"?: Json,"p_request": Json,"p_stops": Json,"p_task": Json }; Returns: Json
                           },
"office_can":
{ Args: { "p_permission": string }; Returns: boolean
                           },
"office_clock_out":
{ Args: { "p_by": string,"p_employee": string,"p_reason"?: string }; Returns: Json
                           },
"office_create_task":
{ Args: { "p_decided_by"?: string,"p_projects"?: Json,"p_request_id"?: string,"p_stops": Json,"p_task": Json }; Returns: string
                           },
"office_move_vehicle":
{ Args: { "p_by": string,"p_employee": string,"p_vehicle": string }; Returns: Json
                           },
"office_reopen_task":
{ Args: { "p_by": string,"p_reason": string,"p_task": string }; Returns: Json
                           },
"office_swap_reading":
{ Args: { "p_by": string,"p_kind": string,"p_km": number,"p_task": string,"p_vehicle": string }; Returns: Json
                           },
"office_swap_vehicle":
{ Args: { "p_by": string,"p_new_start"?: number,"p_old_end"?: number,"p_reason"?: string,"p_task": string,"p_vehicle": string }; Returns: Json
                           },
"office_update_task_stops":
{ Args: { "p_stops": Json,"p_task": Json,"p_task_id": string,"p_version": number }; Returns: number
                           },
"prune_driver_heartbeats":
{ Args: { "p_batch"?: number,"p_keep_days"?: number }; Returns: number
                           },
"prune_google_content":
{ Args: { "p_days"?: number }; Returns: Json
                           },
"prune_location_data":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"prune_location_points":
{ Args: { "p_batch"?: number,"p_keep_days"?: number }; Returns: number
                           },
"prune_route_matched":
{ Args: { "p_keep_days"?: number }; Returns: number
                           },
"queue_accept_reminders":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"queue_notification":
{ Args: { "p_event": string,"p_payload": Json,"p_recipients": (string)[] }; Returns: number
                           },
"queue_odometer_checks":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"queue_request_reminders":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"queue_task_reminders":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"recent_places":
{ Args: { "p_limit"?: number,"p_since": string,"p_text": string }; Returns: {
              "address": string,"last_used": string,"lat": number,"lng": number,"name": string,"uses": number
            }[]
                           },
"register_device_token":
{ Args: { "p_app_version"?: string,"p_device_model"?: string,"p_language"?: string,"p_platform"?: string,"p_token": string }; Returns: undefined
                           },
"release_vehicle":
{ Args: { "p_at": string,"p_by": string,"p_employee": string,"p_ended_how": string }; Returns: undefined
                           },
"remove_device_token":
{ Args: { "p_token": string }; Returns: undefined
                           },
"request_event_visible":
{ Args: { "p_request_id": string }; Returns: boolean
                           },
"search_places_ranked":
{ Args: { "p_limit"?: number,"p_text": string }; Returns: {
              "address": string,"attribution": string,"depot": string,"district": string,"id": string,"kind": string,"lat": number,"lng": number,"name": string,"operator": string,"other_ids": (string)[],"rank": number,"site_id": string,"source": string
            }[]
                           },
"send_heartbeat":
{ Args: { "p_app_state"?: string,"p_app_version"?: string,"p_at": string,"p_battery_pct"?: number,"p_data_available"?: boolean,"p_fix_age_s"?: number,"p_location_on": boolean,"p_permission": string,"p_queued_points"?: number,"p_rejected_points"?: number,"p_sharing": boolean,"p_video_bytes_waiting"?: number,"p_video_uploads_waiting"?: number }; Returns: Json
                           },
"send_push":
{ Args: { "p_employee_id": string,"p_extra"?: Json,"p_kind": string,"p_task_id": string }; Returns: undefined
                           },
"set_my_photo":
{ Args: { "p_photo_id": string }; Returns: string
                           },
"set_odometer_ai":
{ Args: { "p_ai_status": string,"p_ai_value": number,"p_log_id": string }; Returns: undefined
                           },
"set_vehicle_photo_from_driver":
{ Args: { "p_path": string,"p_thumb_path": string,"p_vehicle_id": string }; Returns: string
                           },
"take_vehicle":
{ Args: { "p_at": string,"p_by": string,"p_client"?: string,"p_employee": string,"p_how": string,"p_task"?: string,"p_vehicle": string }; Returns: string
                           },
"task_km":
{ Args: { "p_end": number,"p_start": number,"p_task": string }; Returns: number
                           },
"undo_place_import":
{ Args: { "p_by": string,"p_import_id": string }; Returns: Json
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

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
