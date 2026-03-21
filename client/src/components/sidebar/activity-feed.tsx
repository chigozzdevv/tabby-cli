import React from "react";
import { motion } from "framer-motion";

export interface Activity {
  id: string;
  type: "trade" | "deposit" | "borrow" | "repay" | "alert";
  title: string;
  description: string;
  timestamp: string;
}

export const ActivityFeed: React.FC<{ activities: Activity[] }> = ({ activities }) => {
  return (
    <div className="panel flex h-full flex-col">
      <div className="panel-header">
        <span>Recent Activities</span>
        <span className="text-[9px] text-tactical-accent animate-pulse">LIVE</span>
      </div>
      <div className="panel-content overflow-y-auto flex-1">
        <div className="flex flex-col gap-3">
          {activities.length === 0 ? (
            <div className="text-center text-tactical-dim text-[10px] py-10 uppercase italic">
              No activity signals incoming...
            </div>
          ) : (
            activities.map((activity) => (
              <motion.div
                key={activity.id}
                initial={{ opacity: 0, x: -5 }}
                animate={{ opacity: 1, x: 0 }}
                className="activity-item"
              >
                <div className="flex justify-between items-start mb-1">
                  <span className="font-bold uppercase text-[10px] text-tactical-accent">{activity.type}</span>
                  <span className="text-[9px] text-tactical-dim">{activity.timestamp}</span>
                </div>
                <div className="font-bold text-[12px]">{activity.title}</div>
                <div className="text-[10px] text-tactical-dim leading-tight">{activity.description}</div>
              </motion.div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
