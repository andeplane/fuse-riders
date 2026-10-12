import { edge, node, type City } from "./city.js";

/**
 * Fusetown, the harbour town: curvy streets round a town square with a clock tower, a bay with a pier, boats, a
 * footbridge and a lighthouse. Traced over the 1536 × 1024 concept board (`docs/cities/` keeps the other concepts);
 * the picture itself is the art table's `board-fusetown`, drawn at whatever size it has.
 *
 * The streets: the main road north of the square, the roads round the square (a crossroads at its south-west corner),
 * the road down past the Gigafactory to City College, the road past the market corner and Mono Burger, the shopping
 * street past Neobank, Gadget Garage and FreshCo with the western loop under The Tower, and the waterfront past the
 * docks and the Job Hub, which crosses the canal on the footbridge and reaches the crossroads by the sidewalk along
 * the canal.
 */
export const FUSETOWN: City = {
  id: "fusetown",
  name: "Fusetown",
  map: { art: "board-fusetown", width: 1536, height: 1024 },
  nodes: [
    // Junctions.
    node("north-west", 448, 298),
    node("clock-corner", 893, 286),
    node("market-corner", 1166, 390),
    node("factory-corner", 871, 500),
    node("college-corner", 1071, 569),
    node("quay-corner", 1032, 748),
    node("crossing", 632, 593),
    node("west-bend", 88, 362),
    node("south-west-bend", 46, 693),
    node("bridge-west", 690, 772),
    node("bridge-east", 818, 777),
    // Doors, in front of each building.
    node("roomshare", 790, 259),
    node("keynest", 565, 279),
    node("tower", 248, 362),
    node("freshco", 215, 641),
    node("neobank", 465, 624),
    node("gigafactory", 978, 536),
    node("jobhub", 872, 777),
    node("college", 1290, 825),
    node("gadget", 312, 624),
    node("threads", 521, 859),
    node("mono", 1153, 456),
    node("megamart", 1305, 264),
    node("resale", 1052, 324),
    node("docks", 966, 763),
  ],
  edges: [
    // The road under the tower and the main road north of the square.
    edge("west-bend", "tower", [
      [129, 380],
      [195, 372],
    ]),
    edge("tower", "north-west", [
      [300, 344],
      [350, 327],
      [398, 308],
    ]),
    edge("north-west", "keynest", [[505, 290]]),
    edge("keynest", "roomshare", [
      [616, 276],
      [661, 269],
      [710, 261],
    ]),
    edge("roomshare", "clock-corner", [[845, 266]]),
    edge("clock-corner", "resale", [[975, 297]]),
    edge("resale", "market-corner", [
      [1078, 343],
      [1124, 362],
    ]),
    // Into the car park in front of the supermarket.
    edge("market-corner", "megamart", [
      [1190, 355],
      [1222, 318],
      [1252, 284],
    ]),
    // Down past the burger joint to the college.
    edge("market-corner", "mono", [[1164, 423]]),
    edge("mono", "college-corner", [
      [1130, 503],
      [1102, 542],
    ]),
    // Round the town square.
    edge("clock-corner", "factory-corner", [
      [881, 305],
      [864, 340],
      [868, 380],
      [882, 429],
      [872, 470],
    ]),
    edge("factory-corner", "gigafactory", [
      [900, 513],
      [933, 523],
    ]),
    edge("gigafactory", "college-corner", [[1035, 555]]),
    edge("north-west", "crossing", [
      [460, 340],
      [486, 382],
      [518, 418],
      [542, 452],
      [563, 495],
      [599, 538],
    ]),
    edge("crossing", "factory-corner", [
      [681, 579],
      [733, 571],
      [782, 549],
      [828, 521],
    ]),
    // The waterfront.
    edge("college-corner", "quay-corner", [
      [1064, 610],
      [1057, 655],
      [1040, 704],
    ]),
    edge("quay-corner", "docks", [[1004, 748]]),
    edge("docks", "jobhub", [[915, 770]]),
    edge("jobhub", "bridge-east", [[840, 781]]),
    edge(
      "bridge-east",
      "bridge-west",
      [
        [800, 754],
        [750, 750],
        [705, 756],
      ],
      "bridge",
    ),
    edge("quay-corner", "college", [
      [1070, 758],
      [1109, 765],
      [1185, 790],
      [1240, 810],
    ]),
    edge("bridge-west", "threads", [
      [705, 792],
      [690, 818],
      [650, 835],
      [602, 848],
    ]),
    edge(
      "crossing",
      "bridge-west",
      [
        [614, 640],
        [612, 700],
        [630, 752],
      ],
      "path",
    ),
    // The shopping street and the western loop.
    edge("crossing", "neobank", [
      [591, 615],
      [521, 625],
    ]),
    edge("neobank", "gadget", [[400, 625]]),
    edge("gadget", "freshco", [[260, 635]]),
    edge("freshco", "south-west-bend", [
      [171, 658],
      [131, 671],
      [96, 692],
    ]),
    edge("south-west-bend", "west-bend", [
      [43, 649],
      [28, 600],
      [14, 550],
      [10, 500],
      [43, 460],
      [78, 425],
    ]),
  ],
  places: [
    {
      id: "roomshare",
      door: "roomshare",
      tap: [
        [676, 30],
        [895, 30],
        [895, 208],
        [676, 208],
      ],
      label: [782, 212],
    },
    {
      id: "keynest",
      door: "keynest",
      tap: [
        [458, 58],
        [632, 58],
        [632, 238],
        [458, 238],
      ],
      label: [572, 246],
    },
    {
      id: "tower",
      door: "tower",
      tap: [
        [95, 8],
        [288, 8],
        [288, 300],
        [95, 300],
      ],
      label: [168, 300],
    },
    {
      id: "freshco",
      door: "freshco",
      tap: [
        [75, 380],
        [332, 380],
        [332, 578],
        [75, 578],
      ],
      label: [228, 588],
    },
    {
      id: "neobank",
      door: "neobank",
      tap: [
        [352, 385],
        [565, 385],
        [565, 592],
        [352, 592],
      ],
      label: [476, 598],
    },
    {
      id: "gigafactory",
      door: "gigafactory",
      tap: [
        [900, 300],
        [1095, 300],
        [1095, 505],
        [900, 505],
      ],
      label: [966, 496],
    },
    {
      id: "jobhub",
      door: "jobhub",
      tap: [
        [800, 520],
        [1005, 520],
        [1005, 708],
        [800, 708],
      ],
      label: [872, 718],
    },
    {
      id: "college",
      door: "college",
      tap: [
        [1165, 512],
        [1455, 512],
        [1455, 765],
        [1165, 765],
      ],
      label: [1255, 736],
    },
    {
      id: "gadget",
      door: "gadget",
      tap: [
        [115, 640],
        [338, 640],
        [338, 822],
        [115, 822],
      ],
      label: [226, 830],
    },
    {
      id: "threads",
      door: "threads",
      tap: [
        [375, 640],
        [605, 640],
        [605, 812],
        [375, 812],
      ],
      label: [488, 818],
    },
    {
      id: "mono",
      door: "mono",
      tap: [
        [1225, 288],
        [1450, 288],
        [1450, 508],
        [1225, 508],
      ],
      label: [1330, 510],
    },
    {
      id: "megamart",
      door: "megamart",
      tap: [
        [1195, 15],
        [1510, 15],
        [1510, 225],
        [1195, 225],
      ],
      label: [1355, 232],
    },
    {
      id: "resale",
      door: "resale",
      tap: [
        [995, 85],
        [1170, 85],
        [1170, 256],
        [995, 256],
      ],
      label: [1066, 262],
    },
    {
      id: "docks",
      door: "docks",
      tap: [
        [785, 822],
        [1050, 812],
        [1300, 850],
        [1300, 1000],
        [785, 1000],
      ],
      label: [1000, 898],
    },
  ],
  start: "roomshare",
  occluders: [
    // The clock tower's spire stands in front of the main road.
    {
      shape: [
        [748, 244],
        [762, 244],
        [770, 274],
        [800, 310],
        [800, 330],
        [708, 330],
        [710, 310],
        [740, 274],
      ],
      base: 430,
    },
  ],
};
