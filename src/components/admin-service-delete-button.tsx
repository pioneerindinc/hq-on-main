"use client";

import { deleteService } from "@/app/actions/staff";

export function AdminServiceDeleteButton({ serviceName }: { serviceName: string }) {
  return (
    <button
      className="admin-service-delete"
      type="submit"
      formAction={deleteService}
      onClick={(event) => {
        if (!window.confirm(`Delete ${serviceName}? Existing appointments will keep their saved service details.`)) {
          event.preventDefault();
        }
      }}
    >
      Delete service
    </button>
  );
}
