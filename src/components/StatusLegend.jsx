import React from "react";

export default function StatusLegend() {
  const statuses = [
    { color: "#F39200", label: "Beklemede" },    // Orange
    { color: "#74B4DE", label: "Onaylandı" },    // Blue
    { color: "#E0653A", label: "Reddedildi" },   // Red
    { color: "#818285", label: "İptal Edildi" }, // Gray
  ];

  return (
    <div
      style={{
        display: "flex",
        gap: 24,
        marginTop: 16,
        fontSize: 14,
        color: "#434344",
        fontFamily: "Urbanist, Arial, sans-serif",
      }}
      aria-label="İzin durumu açıklaması"
      role="list"
    >
      {statuses.map((status) => (
        <div
          key={status.label}
          style={{ display: "flex", alignItems: "center", gap: 8 }}
          role="listitem"
        >
          <span
            style={{
              width: 16,
              height: 16,
              borderRadius: "50%",
              backgroundColor: status.color,
              display: "inline-block",
            }}
            aria-hidden="true"
          />
          <span>{status.label}</span>
        </div>
      ))}
    </div>
  );
}
