
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
                },"driver_latest": {
                  Row: {
                    "accuracy_m": number | null,"battery_pct": number | null,"employee_id": string,"hb_app_version": string | null,"hb_at": string | null,"hb_battery_pct": number | null,"hb_location_off_since": string | null,"hb_location_on": boolean | null,"hb_permission": string | null,"hb_queued_points": number | null,"hb_sharing": boolean | null,"lat": number | null,"lng": number | null,"recorded_at": string | null,"session_id": string | null,"sharing": boolean,"speed_mps": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "accuracy_m"?: number | null,"battery_pct"?: number | null,"employee_id": string,"hb_app_version"?: string | null,"hb_at"?: string | null,"hb_battery_pct"?: number | null,"hb_location_off_since"?: string | null,"hb_location_on"?: boolean | null,"hb_permission"?: string | null,"hb_queued_points"?: number | null,"hb_sharing"?: boolean | null,"lat"?: number | null,"lng"?: number | null,"recorded_at"?: string | null,"session_id"?: string | null,"sharing"?: boolean,"speed_mps"?: number | null
                  }
                  Update: {
                    "accuracy_m"?: number | null,"battery_pct"?: number | null,"employee_id"?: string,"hb_app_version"?: string | null,"hb_at"?: string | null,"hb_battery_pct"?: number | null,"hb_location_off_since"?: string | null,"hb_location_on"?: boolean | null,"hb_permission"?: string | null,"hb_queued_points"?: number | null,"hb_sharing"?: boolean | null,"lat"?: number | null,"lng"?: number | null,"recorded_at"?: string | null,"session_id"?: string | null,"sharing"?: boolean,"speed_mps"?: number | null
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
                    "address": string | null,"arrived_at": string | null,"done_at": string | null,"id": string,"lat": number | null,"lng": number | null,"place_id": string | null,"place_name": string,"seq": number,"status": string,"task_id": string,"type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"arrived_at"?: string | null,"done_at"?: string | null,"id"?: string,"lat"?: number | null,"lng"?: number | null,"place_id"?: string | null,"place_name": string,"seq": number,"status"?: string,"task_id": string,"type": string
                  }
                  Update: {
                    "address"?: string | null,"arrived_at"?: string | null,"done_at"?: string | null,"id"?: string,"lat"?: number | null,"lng"?: number | null,"place_id"?: string | null,"place_name"?: string,"seq"?: number,"status"?: string,"task_id"?: string,"type"?: string
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
                    "cancelled_reason": string | null,"completed_at": string | null,"contact_name": string | null,"contact_phone": string | null,"created_at": string,"created_by": string | null,"employee_id": string,"end_by": string | null,"end_odometer_km": number | null,"id": string,"km": number | null,"label": string | null,"notes": string | null,"passengers": number | null,"request_id": string | null,"seen_at": string | null,"sent_at": string,"start_at": string,"start_odometer_km": number | null,"started_at": string | null,"status": string,"title": string,"updated_at": string,"vehicle_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cancelled_reason"?: string | null,"completed_at"?: string | null,"contact_name"?: string | null,"contact_phone"?: string | null,"created_at"?: string,"created_by"?: string | null,"employee_id": string,"end_by"?: string | null,"end_odometer_km"?: number | null,"id"?: string,"km"?: never,"label"?: string | null,"notes"?: string | null,"passengers"?: number | null,"request_id"?: string | null,"seen_at"?: string | null,"sent_at"?: string,"start_at": string,"start_odometer_km"?: number | null,"started_at"?: string | null,"status"?: string,"title": string,"updated_at"?: string,"vehicle_id": string
                  }
                  Update: {
                    "cancelled_reason"?: string | null,"completed_at"?: string | null,"contact_name"?: string | null,"contact_phone"?: string | null,"created_at"?: string,"created_by"?: string | null,"employee_id"?: string,"end_by"?: string | null,"end_odometer_km"?: number | null,"id"?: string,"km"?: never,"label"?: string | null,"notes"?: string | null,"passengers"?: number | null,"request_id"?: string | null,"seen_at"?: string | null,"sent_at"?: string,"start_at"?: string,"start_odometer_km"?: number | null,"started_at"?: string | null,"status"?: string,"title"?: string,"updated_at"?: string,"vehicle_id"?: string
                  }
                  Relationships: [
                    {
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
                    "back_by": string | null,"created_at": string,"decided_at": string | null,"decided_by": string | null,"decline_reason": string | null,"id": string,"need_type": string | null,"needed_at": string,"note": string | null,"pax": number | null,"project_id": string | null,"project_label": string | null,"requested_by_employee_id": string | null,"requested_by_name": string,"route_from": string | null,"route_to": string | null,"status": string,"task_id": string | null,"tools": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "back_by"?: string | null,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decline_reason"?: string | null,"id"?: string,"need_type"?: string | null,"needed_at": string,"note"?: string | null,"pax"?: number | null,"project_id"?: string | null,"project_label"?: string | null,"requested_by_employee_id"?: string | null,"requested_by_name": string,"route_from"?: string | null,"route_to"?: string | null,"status"?: string,"task_id"?: string | null,"tools"?: boolean
                  }
                  Update: {
                    "back_by"?: string | null,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decline_reason"?: string | null,"id"?: string,"need_type"?: string | null,"needed_at"?: string,"note"?: string | null,"pax"?: number | null,"project_id"?: string | null,"project_label"?: string | null,"requested_by_employee_id"?: string | null,"requested_by_name"?: string,"route_from"?: string | null,"route_to"?: string | null,"status"?: string,"task_id"?: string | null,"tools"?: boolean
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
                    "active": boolean,"created_at": string,"current_odometer_km": number | null,"emission_expiry": string | null,"garage_booked_date": string | null,"id": string,"in_garage": boolean,"insurance_expiry": string | null,"last_service_odometer_km": number | null,"licence_expiry": string | null,"make_model": string | null,"monthly_km_allowance": number | null,"monthly_rent_cents": number | null,"next_service_date": string | null,"reg_no": string,"regular_driver_id": string | null,"rent_until": string | null,"rental_company_id": string | null,"seats": number | null,"service_interval_km": number | null,"updated_at": string,"vehicle_type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"current_odometer_km"?: number | null,"emission_expiry"?: string | null,"garage_booked_date"?: string | null,"id"?: string,"in_garage"?: boolean,"insurance_expiry"?: string | null,"last_service_odometer_km"?: number | null,"licence_expiry"?: string | null,"make_model"?: string | null,"monthly_km_allowance"?: number | null,"monthly_rent_cents"?: number | null,"next_service_date"?: string | null,"reg_no": string,"regular_driver_id"?: string | null,"rent_until"?: string | null,"rental_company_id"?: string | null,"seats"?: number | null,"service_interval_km"?: number | null,"updated_at"?: string,"vehicle_type"?: string
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"current_odometer_km"?: number | null,"emission_expiry"?: string | null,"garage_booked_date"?: string | null,"id"?: string,"in_garage"?: boolean,"insurance_expiry"?: string | null,"last_service_odometer_km"?: number | null,"licence_expiry"?: string | null,"make_model"?: string | null,"monthly_km_allowance"?: number | null,"monthly_rent_cents"?: number | null,"next_service_date"?: string | null,"reg_no"?: string,"regular_driver_id"?: string | null,"rent_until"?: string | null,"rental_company_id"?: string | null,"seats"?: number | null,"service_interval_km"?: number | null,"updated_at"?: string,"vehicle_type"?: string
                  }
                  Relationships: [
                    {
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
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "current_employee_id":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"current_office_role":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"odometer_log_flag":
{ Args: { "p_ai_status": string,"p_ai_value": number,"p_entry": string,"p_reading": number }; Returns: string
                           },
"office_can":
{ Args: { "p_permission": string }; Returns: boolean
                           },
"office_create_task":
{ Args: { "p_decided_by"?: string,"p_projects"?: Json,"p_request_id"?: string,"p_stops": Json,"p_task": Json }; Returns: string
                           },
"prune_location_points":
{ Args: { "p_batch"?: number,"p_keep_days"?: number }; Returns: number
                           },
"queue_odometer_checks":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"register_device_token":
{ Args: { "p_app_version"?: string,"p_device_model"?: string,"p_language"?: string,"p_platform"?: string,"p_token": string }; Returns: undefined
                           },
"remove_device_token":
{ Args: { "p_token": string }; Returns: undefined
                           },
"send_heartbeat":
{ Args: { "p_app_version"?: string,"p_at": string,"p_battery_pct"?: number,"p_location_on": boolean,"p_permission": string,"p_queued_points"?: number,"p_sharing": boolean }; Returns: undefined
                           },
"send_push":
{ Args: { "p_employee_id": string,"p_kind": string,"p_task_id": string }; Returns: undefined
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
