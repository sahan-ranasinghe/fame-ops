
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
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
                    "app_state": string | null,"app_version": string | null,"at": string,"battery_pct": number | null,"data_available": boolean | null,"dropped_accuracy": number | null,"dropped_duplicate": number | null,"dropped_jitter": number | null,"dropped_jump": number | null,"employee_id": string,"fixes_seen": number | null,"fixes_stored": number | null,"id": number,"last_gps_fix_age_s": number | null,"location_on": boolean | null,"permission": string | null,"queued_points": number | null,"received_at": string,"rejected_points": number | null,"session_id": string | null,"sharing": boolean | null
                  }
                  ComputedFields: never
                  Insert: {
                    "app_state"?: string | null,"app_version"?: string | null,"at": string,"battery_pct"?: number | null,"data_available"?: boolean | null,"dropped_accuracy"?: number | null,"dropped_duplicate"?: number | null,"dropped_jitter"?: number | null,"dropped_jump"?: number | null,"employee_id": string,"fixes_seen"?: number | null,"fixes_stored"?: number | null,"id"?: never,"last_gps_fix_age_s"?: number | null,"location_on"?: boolean | null,"permission"?: string | null,"queued_points"?: number | null,"received_at"?: string,"rejected_points"?: number | null,"session_id"?: string | null,"sharing"?: boolean | null
                  }
                  Update: {
                    "app_state"?: string | null,"app_version"?: string | null,"at"?: string,"battery_pct"?: number | null,"data_available"?: boolean | null,"dropped_accuracy"?: number | null,"dropped_duplicate"?: number | null,"dropped_jitter"?: number | null,"dropped_jump"?: number | null,"employee_id"?: string,"fixes_seen"?: number | null,"fixes_stored"?: number | null,"id"?: never,"last_gps_fix_age_s"?: number | null,"location_on"?: boolean | null,"permission"?: string | null,"queued_points"?: number | null,"received_at"?: string,"rejected_points"?: number | null,"session_id"?: string | null,"sharing"?: boolean | null
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
                    "accuracy_m": number | null,"battery_pct": number | null,"employee_id": string,"hb_app_state": string | null,"hb_app_version": string | null,"hb_at": string | null,"hb_battery_pct": number | null,"hb_data_available": boolean | null,"hb_fix_age_s": number | null,"hb_location_off_since": string | null,"hb_location_on": boolean | null,"hb_permission": string | null,"hb_queued_points": number | null,"hb_rejected_points": number | null,"hb_sharing": boolean | null,"heading": number | null,"lat": number | null,"lng": number | null,"recorded_at": string | null,"session_id": string | null,"sharing": boolean,"speed_mps": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "accuracy_m"?: number | null,"battery_pct"?: number | null,"employee_id": string,"hb_app_state"?: string | null,"hb_app_version"?: string | null,"hb_at"?: string | null,"hb_battery_pct"?: number | null,"hb_data_available"?: boolean | null,"hb_fix_age_s"?: number | null,"hb_location_off_since"?: string | null,"hb_location_on"?: boolean | null,"hb_permission"?: string | null,"hb_queued_points"?: number | null,"hb_rejected_points"?: number | null,"hb_sharing"?: boolean | null,"heading"?: number | null,"lat"?: number | null,"lng"?: number | null,"recorded_at"?: string | null,"session_id"?: string | null,"sharing"?: boolean,"speed_mps"?: number | null
                  }
                  Update: {
                    "accuracy_m"?: number | null,"battery_pct"?: number | null,"employee_id"?: string,"hb_app_state"?: string | null,"hb_app_version"?: string | null,"hb_at"?: string | null,"hb_battery_pct"?: number | null,"hb_data_available"?: boolean | null,"hb_fix_age_s"?: number | null,"hb_location_off_since"?: string | null,"hb_location_on"?: boolean | null,"hb_permission"?: string | null,"hb_queued_points"?: number | null,"hb_rejected_points"?: number | null,"hb_sharing"?: boolean | null,"heading"?: number | null,"lat"?: number | null,"lng"?: number | null,"recorded_at"?: string | null,"session_id"?: string | null,"sharing"?: boolean,"speed_mps"?: number | null
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
                    "active": boolean,"auth_user_id": string | null,"code": string,"created_at": string,"current_vehicle_id": string | null,"email": string | null,"id": string,"language": string,"licence_expiry": string | null,"name": string,"permissions": (string)[],"phone": string | null,"role": string,"updated_at": string,"username": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"auth_user_id"?: string | null,"code": string,"created_at"?: string,"current_vehicle_id"?: string | null,"email"?: string | null,"id"?: string,"language"?: string,"licence_expiry"?: string | null,"name": string,"permissions"?: (string)[],"phone"?: string | null,"role"?: string,"updated_at"?: string,"username"?: string | null
                  }
                  Update: {
                    "active"?: boolean,"auth_user_id"?: string | null,"code"?: string,"created_at"?: string,"current_vehicle_id"?: string | null,"email"?: string | null,"id"?: string,"language"?: string,"licence_expiry"?: string | null,"name"?: string,"permissions"?: (string)[],"phone"?: string | null,"role"?: string,"updated_at"?: string,"username"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "employees_current_vehicle_id_fkey"
      columns: ["current_vehicle_id"]
isOneToOne: false
      referencedRelation: "vehicles"
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
                    "amount_cents": number | null,"employee_id": string,"id": string,"litres": number | null,"logged_at": string,"odometer_km": number | null,"receipt_photo_id": string | null,"task_id": string | null,"vehicle_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents"?: number | null,"employee_id": string,"id"?: string,"litres"?: number | null,"logged_at"?: string,"odometer_km"?: number | null,"receipt_photo_id"?: string | null,"task_id"?: string | null,"vehicle_id": string
                  }
                  Update: {
                    "amount_cents"?: number | null,"employee_id"?: string,"id"?: string,"litres"?: number | null,"logged_at"?: string,"odometer_km"?: number | null,"receipt_photo_id"?: string | null,"task_id"?: string | null,"vehicle_id"?: string
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
                },"places": {
                  Row: {
                    "address": string | null,"created_at": string,"id": string,"kind": string,"lat": number | null,"lng": number | null,"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"created_at"?: string,"id"?: string,"kind"?: string,"lat"?: number | null,"lng"?: number | null,"name": string
                  }
                  Update: {
                    "address"?: string | null,"created_at"?: string,"id"?: string,"kind"?: string,"lat"?: number | null,"lng"?: number | null,"name"?: string
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
                    "address": string | null,"arrive_by": string | null,"arrived_at": string | null,"done_at": string | null,"dwell_min": number | null,"id": string,"lat": number | null,"lng": number | null,"note": string | null,"place_id": string | null,"place_name": string,"planned_arrive_at": string | null,"planned_depart_at": string | null,"removed_at": string | null,"seq": number,"skip_note": string | null,"skip_reason": string | null,"status": string,"task_id": string,"type": string,"what": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"arrive_by"?: string | null,"arrived_at"?: string | null,"done_at"?: string | null,"dwell_min"?: number | null,"id"?: string,"lat"?: number | null,"lng"?: number | null,"note"?: string | null,"place_id"?: string | null,"place_name": string,"planned_arrive_at"?: string | null,"planned_depart_at"?: string | null,"removed_at"?: string | null,"seq": number,"skip_note"?: string | null,"skip_reason"?: string | null,"status"?: string,"task_id": string,"type": string,"what"?: string | null
                  }
                  Update: {
                    "address"?: string | null,"arrive_by"?: string | null,"arrived_at"?: string | null,"done_at"?: string | null,"dwell_min"?: number | null,"id"?: string,"lat"?: number | null,"lng"?: number | null,"note"?: string | null,"place_id"?: string | null,"place_name"?: string,"planned_arrive_at"?: string | null,"planned_depart_at"?: string | null,"removed_at"?: string | null,"seq"?: number,"skip_note"?: string | null,"skip_reason"?: string | null,"status"?: string,"task_id"?: string,"type"?: string,"what"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "task_stops_place_id_fkey"
      columns: ["place_id"]
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
                },"tasks": {
                  Row: {
                    "accept_reminder_sent_at": string | null,"accepted_at": string | null,"avoid_expressway": boolean,"buffer_min": number | null,"cancelled_reason": string | null,"completed_at": string | null,"contact_name": string | null,"contact_phone": string | null,"created_at": string,"created_by": string | null,"declined_after_accept": boolean,"declined_at": string | null,"declined_by": string | null,"declined_note": string | null,"declined_reason": string | null,"employee_id": string,"end_by": string | null,"end_odometer_km": number | null,"id": string,"km": number | null,"label": string | null,"leave_by": string | null,"leave_by_source": string | null,"notes": string | null,"passengers": number | null,"plan_json": Json | null,"plan_version": number,"reminder_0_sent_at": string | null,"reminder_30_sent_at": string | null,"request_id": string | null,"return_to_base": boolean,"seen_at": string | null,"sent_at": string,"start_at": string,"start_lat": number | null,"start_lng": number | null,"start_name": string | null,"start_odometer_km": number | null,"start_place_id": string | null,"started_at": string | null,"status": string,"title": string,"updated_at": string,"vehicle_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accept_reminder_sent_at"?: string | null,"accepted_at"?: string | null,"avoid_expressway"?: boolean,"buffer_min"?: number | null,"cancelled_reason"?: string | null,"completed_at"?: string | null,"contact_name"?: string | null,"contact_phone"?: string | null,"created_at"?: string,"created_by"?: string | null,"declined_after_accept"?: boolean,"declined_at"?: string | null,"declined_by"?: string | null,"declined_note"?: string | null,"declined_reason"?: string | null,"employee_id": string,"end_by"?: string | null,"end_odometer_km"?: number | null,"id"?: string,"km"?: never,"label"?: string | null,"leave_by"?: string | null,"leave_by_source"?: string | null,"notes"?: string | null,"passengers"?: number | null,"plan_json"?: Json | null,"plan_version"?: number,"reminder_0_sent_at"?: string | null,"reminder_30_sent_at"?: string | null,"request_id"?: string | null,"return_to_base"?: boolean,"seen_at"?: string | null,"sent_at"?: string,"start_at": string,"start_lat"?: number | null,"start_lng"?: number | null,"start_name"?: string | null,"start_odometer_km"?: number | null,"start_place_id"?: string | null,"started_at"?: string | null,"status"?: string,"title": string,"updated_at"?: string,"vehicle_id": string
                  }
                  Update: {
                    "accept_reminder_sent_at"?: string | null,"accepted_at"?: string | null,"avoid_expressway"?: boolean,"buffer_min"?: number | null,"cancelled_reason"?: string | null,"completed_at"?: string | null,"contact_name"?: string | null,"contact_phone"?: string | null,"created_at"?: string,"created_by"?: string | null,"declined_after_accept"?: boolean,"declined_at"?: string | null,"declined_by"?: string | null,"declined_note"?: string | null,"declined_reason"?: string | null,"employee_id"?: string,"end_by"?: string | null,"end_odometer_km"?: number | null,"id"?: string,"km"?: never,"label"?: string | null,"leave_by"?: string | null,"leave_by_source"?: string | null,"notes"?: string | null,"passengers"?: number | null,"plan_json"?: Json | null,"plan_version"?: number,"reminder_0_sent_at"?: string | null,"reminder_30_sent_at"?: string | null,"request_id"?: string | null,"return_to_base"?: boolean,"seen_at"?: string | null,"sent_at"?: string,"start_at"?: string,"start_lat"?: number | null,"start_lng"?: number | null,"start_name"?: string | null,"start_odometer_km"?: number | null,"start_place_id"?: string | null,"started_at"?: string | null,"status"?: string,"title"?: string,"updated_at"?: string,"vehicle_id"?: string
                  }
                  Relationships: [
                    {
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
                },"vehicle_reports": {
                  Row: {
                    "category": string,"closed_at": string | null,"created_at": string,"employee_id": string,"id": string,"note": string | null,"office_note": string | null,"status": string,"task_id": string | null,"vehicle_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "category": string,"closed_at"?: string | null,"created_at"?: string,"employee_id": string,"id"?: string,"note"?: string | null,"office_note"?: string | null,"status"?: string,"task_id"?: string | null,"vehicle_id": string
                  }
                  Update: {
                    "category"?: string,"closed_at"?: string | null,"created_at"?: string,"employee_id"?: string,"id"?: string,"note"?: string | null,"office_note"?: string | null,"status"?: string,"task_id"?: string | null,"vehicle_id"?: string
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
                    "back_by": string | null,"cancel_reason": string | null,"cancelled_at": string | null,"cancelled_by": string | null,"change_note": string | null,"changed_at": string | null,"changed_by": string | null,"created_at": string,"decided_at": string | null,"decided_by": string | null,"decline_reason": string | null,"driver_required": boolean,"id": string,"need_type": string | null,"needed_at": string,"note": string | null,"on_behalf_of": string | null,"one_step": boolean,"pax": number | null,"previous": Json | null,"project_id": string | null,"project_label": string | null,"requested_by_employee_id": string | null,"requested_by_name": string,"requested_by_user_id": string | null,"route_from": string | null,"route_to": string | null,"seen_at": string | null,"seen_by": string | null,"status": string,"task_id": string | null,"tools": boolean,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "back_by"?: string | null,"cancel_reason"?: string | null,"cancelled_at"?: string | null,"cancelled_by"?: string | null,"change_note"?: string | null,"changed_at"?: string | null,"changed_by"?: string | null,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decline_reason"?: string | null,"driver_required"?: boolean,"id"?: string,"need_type"?: string | null,"needed_at": string,"note"?: string | null,"on_behalf_of"?: string | null,"one_step"?: boolean,"pax"?: number | null,"previous"?: Json | null,"project_id"?: string | null,"project_label"?: string | null,"requested_by_employee_id"?: string | null,"requested_by_name": string,"requested_by_user_id"?: string | null,"route_from"?: string | null,"route_to"?: string | null,"seen_at"?: string | null,"seen_by"?: string | null,"status"?: string,"task_id"?: string | null,"tools"?: boolean,"version"?: number
                  }
                  Update: {
                    "back_by"?: string | null,"cancel_reason"?: string | null,"cancelled_at"?: string | null,"cancelled_by"?: string | null,"change_note"?: string | null,"changed_at"?: string | null,"changed_by"?: string | null,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decline_reason"?: string | null,"driver_required"?: boolean,"id"?: string,"need_type"?: string | null,"needed_at"?: string,"note"?: string | null,"on_behalf_of"?: string | null,"one_step"?: boolean,"pax"?: number | null,"previous"?: Json | null,"project_id"?: string | null,"project_label"?: string | null,"requested_by_employee_id"?: string | null,"requested_by_name"?: string,"requested_by_user_id"?: string | null,"route_from"?: string | null,"route_to"?: string | null,"seen_at"?: string | null,"seen_by"?: string | null,"status"?: string,"task_id"?: string | null,"tools"?: boolean,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "vehicle_requests_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "vehicle_requests_requested_by_employee_id_fkey"
      columns: ["requested_by_employee_id"]
isOneToOne: false
      referencedRelation: "employees"
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
                    "active": boolean,"created_at": string,"current_odometer_km": number | null,"custodian_employee_id": string | null,"custodian_note": string | null,"emission_expiry": string | null,"garage_booked_date": string | null,"id": string,"in_garage": boolean,"insurance_expiry": string | null,"last_service_odometer_km": number | null,"licence_expiry": string | null,"make_model": string | null,"monthly_km_allowance": number | null,"monthly_rent_cents": number | null,"next_service_date": string | null,"reg_no": string,"regular_driver_id": string | null,"rent_until": string | null,"rental_company_id": string | null,"seats": number | null,"service_interval_km": number | null,"updated_at": string,"vehicle_type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"current_odometer_km"?: number | null,"custodian_employee_id"?: string | null,"custodian_note"?: string | null,"emission_expiry"?: string | null,"garage_booked_date"?: string | null,"id"?: string,"in_garage"?: boolean,"insurance_expiry"?: string | null,"last_service_odometer_km"?: number | null,"licence_expiry"?: string | null,"make_model"?: string | null,"monthly_km_allowance"?: number | null,"monthly_rent_cents"?: number | null,"next_service_date"?: string | null,"reg_no": string,"regular_driver_id"?: string | null,"rent_until"?: string | null,"rental_company_id"?: string | null,"seats"?: number | null,"service_interval_km"?: number | null,"updated_at"?: string,"vehicle_type"?: string
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"current_odometer_km"?: number | null,"custodian_employee_id"?: string | null,"custodian_note"?: string | null,"emission_expiry"?: string | null,"garage_booked_date"?: string | null,"id"?: string,"in_garage"?: boolean,"insurance_expiry"?: string | null,"last_service_odometer_km"?: number | null,"licence_expiry"?: string | null,"make_model"?: string | null,"monthly_km_allowance"?: number | null,"monthly_rent_cents"?: number | null,"next_service_date"?: string | null,"reg_no"?: string,"regular_driver_id"?: string | null,"rent_until"?: string | null,"rental_company_id"?: string | null,"seats"?: number | null,"service_interval_km"?: number | null,"updated_at"?: string,"vehicle_type"?: string
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
"bump_routing_calls":
{ Args: { "p_ok": boolean,"p_provider": string }; Returns: undefined
                           },
"call_edge_function":
{ Args: { "p_body": Json,"p_name": string }; Returns: undefined
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
"fleet_sync":
{ Args: { "p_scope"?: Json }; Returns: undefined
                           },
"get_driver_settings":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"issue_visible":
{ Args: { "p_kind": string }; Returns: boolean
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
"office_create_task":
{ Args: { "p_decided_by"?: string,"p_projects"?: Json,"p_request_id"?: string,"p_stops": Json,"p_task": Json }; Returns: string
                           },
"office_update_task_stops":
{ Args: { "p_stops": Json,"p_task": Json,"p_task_id": string,"p_version": number }; Returns: number
                           },
"prune_driver_heartbeats":
{ Args: { "p_batch"?: number,"p_keep_days"?: number }; Returns: number
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
"queue_task_reminders":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"register_device_token":
{ Args: { "p_app_version"?: string,"p_device_model"?: string,"p_language"?: string,"p_platform"?: string,"p_token": string }; Returns: undefined
                           },
"remove_device_token":
{ Args: { "p_token": string }; Returns: undefined
                           },
"request_event_visible":
{ Args: { "p_request_id": string }; Returns: boolean
                           },
"send_heartbeat":
{ Args: { "p_app_state"?: string,"p_app_version"?: string,"p_at": string,"p_battery_pct"?: number,"p_data_available"?: boolean,"p_fix_age_s"?: number,"p_location_on": boolean,"p_permission": string,"p_queued_points"?: number,"p_rejected_points"?: number,"p_sharing": boolean }; Returns: undefined
                           },
"send_push":
{ Args: { "p_employee_id": string,"p_extra"?: Json,"p_kind": string,"p_task_id": string }; Returns: undefined
                           },
"set_odometer_ai":
{ Args: { "p_ai_status": string,"p_ai_value": number,"p_log_id": string }; Returns: undefined
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
  "public": {
          Enums: {
            
          }
        }
} as const
