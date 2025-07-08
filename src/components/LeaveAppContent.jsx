import React from "react";
//import VacationBalanceCard from "./VacationBalanceCard";
import LeaveRequestForm from "./LeaveRequestForm";

export default function LeaveAppContent({ user }) {
    if (!user) return null; // Or show a loading spinner/message
// Pass user.id to VacationBalanceCard and user to LeaveRequestForm if needed
//   <VacationBalanceCard userId={user.id} launchDate="01.07.2025" /> removed from main return

  return (
    <div>
      <LeaveRequestForm user={user} />
    </div>
  );
}
