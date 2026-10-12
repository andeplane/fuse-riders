/**
 * The 37 positions and 11 courses of the original (jobs-education notes §2 and §6), reskinned to Fuse Lane's
 * employers and degrees, and the four jobs at Fusetown's docks after them. Numbers are the original's: base wage $/h,
 * the dependability and experience a hire needs, the degrees (course indices) it needs and the clothing level it is
 * worked in. The docks' ladder sits between the store and factory ladders: a casual start, then a trade, then a
 * degree.
 */

/** Clothing levels: a better outfit always qualifies for a lower requirement. */
export const CASUAL = 0,
  SMART = 1,
  BUSINESS = 2;
export const CLOTHING_NAMES = ["Casual", "Smart casual", "Business"] as const;

export interface CourseData {
  name: string;
  /** The degree needed before enrolling, or -1. */
  prereq: number;
}
export const LESSONS = 10;
export const COURSES: readonly CourseData[] = [
  { name: "Trade Cert", prereq: -1 },
  { name: "IoT Technician", prereq: 0 },
  { name: "Pre-Engineering", prereq: 0 },
  { name: "Engineering", prereq: 2 },
  { name: "Community College", prereq: -1 },
  { name: "Business (MBA)", prereq: 4 },
  { name: "Liberal Arts", prereq: 4 },
  { name: "Grad School", prereq: 6 },
  { name: "PhD", prereq: 7 },
  { name: "Research", prereq: 8 },
  { name: "Publishing", prereq: 9 },
];

export interface JobData {
  title: string;
  /** `EMPLOYERS` index. */
  employer: number;
  wage: number;
  dep: number;
  exp: number;
  degrees: readonly number[];
  uniform: number;
  /** Skips the luck roll (the original's Cook). */
  sure?: boolean;
}

const job = (
  employer: number,
  title: string,
  wage: number,
  dep: number,
  exp: number,
  degrees: readonly number[],
  uniform: number,
  sure = false,
): JobData => ({
  title,
  employer,
  wage,
  dep,
  exp,
  degrees,
  uniform,
  ...(sure ? { sure } : {}),
});

const GIGA = 0,
  NEO = 1,
  FRESH = 2,
  MONO = 3,
  GADGET = 4,
  THREADS = 5,
  MEGA = 6,
  KEYNEST = 7,
  PORT = 8,
  COLLEGE = 9;

export const JOBS: readonly JobData[] = [
  job(MEGA, "Floor Associate", 4, 10, 10, [], CASUAL),
  job(MEGA, "Shift Lead", 6, 20, 20, [], SMART),
  job(MEGA, "Store Manager", 7, 30, 30, [4], BUSINESS),
  job(MONO, "Line Cook", 4, 10, 0, [], CASUAL, true),
  job(MONO, "Cashier", 5, 20, 10, [], CASUAL),
  job(MONO, "Shift Supervisor", 6, 30, 20, [], CASUAL),
  job(MONO, "Restaurant Manager", 7, 40, 30, [4], SMART),
  job(THREADS, "Stylist", 7, 30, 30, [], SMART),
  job(THREADS, "Assistant Manager", 9, 40, 40, [4], BUSINESS),
  job(THREADS, "Store Manager", 12, 50, 50, [5], BUSINESS),
  job(GADGET, "Sales Associate", 5, 30, 20, [], SMART),
  job(GADGET, "Repair Tech", 11, 40, 40, [1], CASUAL),
  job(GADGET, "Store Manager", 14, 40, 40, [4, 1], BUSINESS),
  job(COLLEGE, "Custodian", 4, 10, 10, [], CASUAL),
  job(COLLEGE, "Lecturer", 11, 50, 40, [6], SMART),
  job(COLLEGE, "Professor", 20, 60, 50, [9], SMART),
  job(GIGA, "Cleaner", 7, 30, 30, [], CASUAL),
  job(GIGA, "Line Operator", 8, 30, 30, [0], CASUAL),
  job(GIGA, "Office Coordinator", 9, 40, 40, [4], SMART),
  job(GIGA, "Robotics Assistant", 10, 40, 40, [2], CASUAL),
  job(GIGA, "Executive Assistant", 18, 50, 50, [5], BUSINESS),
  job(GIGA, "Robotics Technician", 19, 50, 50, [3], CASUAL),
  job(GIGA, "Department Head", 22, 60, 60, [4, 3], BUSINESS),
  job(GIGA, "Engineer", 23, 60, 60, [3, 4], BUSINESS),
  job(GIGA, "Plant Director", 25, 70, 70, [5, 3], BUSINESS),
  job(NEO, "Facilities Assistant", 6, 20, 20, [], CASUAL),
  job(NEO, "Support Agent", 10, 40, 40, [4], SMART),
  job(NEO, "Product Lead", 14, 50, 50, [5], BUSINESS),
  job(NEO, "Head of Operations", 19, 60, 60, [5], BUSINESS),
  job(NEO, "Investment Analyst", 22, 70, 70, [5, 6], BUSINESS),
  job(FRESH, "Stock Clerk", 5, 10, 10, [], CASUAL),
  job(FRESH, "Checkout", 8, 20, 20, [], CASUAL),
  job(FRESH, "Butcher", 12, 30, 30, [0], CASUAL),
  job(FRESH, "Assistant Manager", 15, 40, 40, [4], SMART),
  job(FRESH, "Store Manager", 18, 50, 50, [5], BUSINESS),
  job(KEYNEST, "Groundskeeper", 6, 20, 20, [], CASUAL),
  job(KEYNEST, "Property Manager", 8, 30, 30, [4], CASUAL),
  job(PORT, "Deckhand", 5, 10, 10, [], CASUAL),
  job(PORT, "Forklift Driver", 9, 20, 20, [0], CASUAL),
  job(PORT, "Crane Operator", 16, 40, 40, [1], CASUAL),
  job(PORT, "Harbour Master", 21, 60, 60, [5], SMART),
];
