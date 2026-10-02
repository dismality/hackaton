"use client";

import { useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type DirectoryItem = {
  id: number;
  name: string;
  phone: string | null;
  skills: string[];
  active: boolean;
  simulated: boolean;
  content: ReactNode;
};

export function WorkersDirectory({ items }: { items: DirectoryItem[] }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const query = search.trim().toLowerCase();
  const phoneQuery = /^[+\d\s()-]+$/.test(query) ? query.replace(/\D/g, "") : "";
  const visible = items.filter((worker) => {
    const matchesSearch = `${worker.name} ${worker.phone ?? ""} ${worker.skills.join(" ")}`.toLowerCase().includes(query)
      || (phoneQuery.length > 0 && (worker.phone ?? "").includes(phoneQuery));
    const matchesFilter = filter === "all"
      || (filter === "active" && worker.active)
      || (filter === "inactive" && !worker.active)
      || (filter === "simulated" && worker.simulated);
    return matchesSearch && matchesFilter;
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="grid flex-1 gap-2">
          <Label htmlFor="team-search">Find a team member</Label>
          <div className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" />
            <Input id="team-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, number or skill" className="h-10 pl-9" />
          </div>
        </div>
        <div className="grid gap-2 sm:w-44">
          <Label htmlFor="team-filter">Show</Label>
          <select id="team-filter" value={filter} onChange={(event) => setFilter(event.target.value)} className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
            <option value="all">Everyone</option>
            <option value="active">Active members</option>
            <option value="inactive">Inactive members</option>
            <option value="simulated">Simulated members</option>
          </select>
        </div>
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">Showing {visible.length} of {items.length} team members</p>
      {visible.length > 0 ? (
        <ul className="divide-y rounded-xl border">
          {visible.map((worker) => <li key={worker.id} className="p-5 sm:p-6">{worker.content}</li>)}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center">
          <p className="font-medium">{items.length ? "No matching team members" : "Your team starts here"}</p>
          <p className="max-w-sm text-sm text-muted-foreground">{items.length ? "Try another name or skill, or show everyone." : "Add your first worker above to start planning their shifts."}</p>
          {items.length > 0 && <Button variant="outline" className="mt-2 h-10" onClick={() => { setSearch(""); setFilter("all"); }}>Clear filters</Button>}
        </div>
      )}
    </div>
  );
}
