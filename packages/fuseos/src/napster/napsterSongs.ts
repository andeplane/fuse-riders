/**
 * The bulk of the fake network's catalogue: what people actually had on their drives in 1999-2001, one song per
 * line as "Artist|Title|m:ss". Titles and artists are facts about real releases; there is no audio anywhere, and
 * lengths are close enough for a Length column. Parsed once into `CatalogSong`s by `napsterCatalog.ts`.
 */
export const SONG_TABLE = `
Metallica|Enter Sandman|5:31
Metallica|Nothing Else Matters|6:28
Metallica|Master of Puppets|8:35
Metallica|Fuel|4:29
Metallica|One|7:24
Metallica|The Unforgiven|6:27
Metallica|Sad but True|5:24
Metallica|Whiskey in the Jar|5:04
Metallica|Turn the Page|6:06
Metallica|No Leaf Clover|5:41
Dr. Dre|Still D.R.E.|4:30
Dr. Dre|Forgot About Dre|3:42
Dr. Dre|The Next Episode|2:41
Eminem|My Name Is|4:28
Eminem|The Real Slim Shady|4:44
Eminem|Stan|6:44
Eminem|The Way I Am|4:50
Eminem|Guilty Conscience|3:19
Blink-182|All the Small Things|2:48
Blink-182|What's My Age Again|2:28
Blink-182|Adam's Song|4:09
Blink-182|Dammit|2:45
Limp Bizkit|Rollin'|3:33
Limp Bizkit|Nookie|4:49
Limp Bizkit|Break Stuff|2:46
Limp Bizkit|Re-Arranged|6:21
Limp Bizkit|My Way|4:34
Britney Spears|...Baby One More Time|3:31
Britney Spears|Oops!... I Did It Again|3:31
Britney Spears|Sometimes|4:04
Britney Spears|Crazy|3:17
Britney Spears|Lucky|3:26
NSYNC|Bye Bye Bye|3:20
NSYNC|It's Gonna Be Me|3:11
NSYNC|Tearin' Up My Heart|3:30
NSYNC|This I Promise You|4:44
Backstreet Boys|I Want It That Way|3:33
Backstreet Boys|Everybody (Backstreet's Back)|3:44
Backstreet Boys|Larger than Life|3:52
Backstreet Boys|Shape of My Heart|3:50
Backstreet Boys|Show Me the Meaning of Being Lonely|3:54
Christina Aguilera|Genie in a Bottle|3:37
Christina Aguilera|What a Girl Wants|3:52
Christina Aguilera|Come On Over Baby|3:23
Santana|Smooth|4:55
Santana|Maria Maria|4:22
Red Hot Chili Peppers|Californication|5:21
Red Hot Chili Peppers|Scar Tissue|3:35
Red Hot Chili Peppers|Otherside|4:15
Red Hot Chili Peppers|Under the Bridge|4:24
Red Hot Chili Peppers|Give It Away|4:43
Radiohead|Karma Police|4:24
Radiohead|Paranoid Android|6:23
Radiohead|Idioteque|5:09
Radiohead|Creep|3:56
Radiohead|No Surprises|3:49
Radiohead|Everything in Its Right Place|4:11
Radiohead|Fake Plastic Trees|4:50
Moby|Porcelain|4:01
Moby|Natural Blues|4:12
Moby|Why Does My Heart Feel So Bad|4:23
Moby|Bodyrock|3:34
Eiffel 65|Blue (Da Ba Dee)|4:44
Eiffel 65|Move Your Body|4:28
Darude|Sandstorm|3:45
Daft Punk|One More Time|5:20
Daft Punk|Around the World|7:09
Daft Punk|Da Funk|5:28
Daft Punk|Digital Love|4:58
The Offspring|Pretty Fly (For a White Guy)|3:08
The Offspring|Why Don't You Get a Job|2:49
The Offspring|Self Esteem|4:17
The Offspring|The Kids Aren't Alright|3:00
Smash Mouth|All Star|3:20
Smash Mouth|Walkin' on the Sun|3:27
Smash Mouth|Then the Morning Comes|3:03
Sugar Ray|Every Morning|3:39
Sugar Ray|Fly|4:53
Sugar Ray|Someday|4:02
Lou Bega|Mambo No. 5|3:40
Ricky Martin|Livin' la Vida Loca|4:03
Ricky Martin|She Bangs|4:40
Destiny's Child|Say My Name|4:31
Destiny's Child|Bills, Bills, Bills|4:16
Destiny's Child|Independent Women Part I|3:41
Destiny's Child|Jumpin', Jumpin'|3:50
TLC|No Scrubs|3:34
TLC|Waterfalls|4:39
TLC|Unpretty|4:38
Coldplay|Yellow|4:29
Coldplay|Trouble|4:33
Coldplay|Shiver|5:02
Creed|Higher|5:16
Creed|With Arms Wide Open|4:34
Creed|My Own Prison|4:58
Matchbox Twenty|Bent|4:16
Matchbox Twenty|3AM|3:45
Matchbox Twenty|Push|3:59
Third Eye Blind|Semi-Charmed Life|4:28
Third Eye Blind|Jumper|4:33
Third Eye Blind|How's It Going to Be|4:13
Everclear|Father of Mine|3:53
Everclear|Santa Monica|3:12
Everclear|Wonderful|4:30
Vertical Horizon|Everything You Want|4:01
Fatboy Slim|Praise You|5:23
Fatboy Slim|The Rockafeller Skank|6:41
Fatboy Slim|Right Here, Right Now|6:27
Fatboy Slim|Weapon of Choice|5:45
The Prodigy|Firestarter|4:40
The Prodigy|Breathe|5:35
The Prodigy|Smack My Bitch Up|5:43
Beastie Boys|Intergalactic|3:51
Beastie Boys|Sabotage|2:58
Beastie Boys|Body Movin'|3:03
Rage Against the Machine|Guerrilla Radio|3:26
Rage Against the Machine|Killing in the Name|5:14
Rage Against the Machine|Bulls on Parade|3:51
Rage Against the Machine|Testify|3:30
Korn|Freak on a Leash|4:15
Korn|Falling Away from Me|4:30
Korn|Got the Life|3:45
Godsmack|Voodoo|4:40
Godsmack|Whatever|4:06
Papa Roach|Last Resort|3:19
Papa Roach|Between Angels and Insects|3:54
Linkin Park|One Step Closer|2:35
Linkin Park|In the End|3:36
Linkin Park|Crawling|3:29
Linkin Park|Papercut|3:04
Green Day|Good Riddance (Time of Your Life)|2:33
Green Day|Basket Case|3:01
Green Day|Minority|2:48
Green Day|When I Come Around|2:58
Weezer|Buddy Holly|2:39
Weezer|Say It Ain't So|4:18
Weezer|Undone - The Sweater Song|5:05
Weezer|Hash Pipe|3:06
Nirvana|Smells Like Teen Spirit|5:01
Nirvana|Come as You Are|3:39
Nirvana|Heart-Shaped Box|4:41
Nirvana|Lithium|4:17
Nirvana|All Apologies|3:51
Foo Fighters|Learn to Fly|3:58
Foo Fighters|Everlong|4:10
Foo Fighters|My Hero|4:20
Foo Fighters|Breakout|3:21
Bloodhound Gang|The Bad Touch|4:20
Chumbawamba|Tubthumping|4:38
Semisonic|Closing Time|4:33
Savage Garden|Truly Madly Deeply|4:38
Savage Garden|I Knew I Loved You|4:10
Madonna|Ray of Light|5:21
Madonna|Music|3:45
Madonna|Frozen|6:12
Madonna|Beautiful Stranger|4:22
Cher|Believe|3:59
Will Smith|Gettin' Jiggy wit It|3:48
Will Smith|Men in Black|3:47
Will Smith|Wild Wild West|4:05
Outkast|Ms. Jackson|4:30
Outkast|B.O.B.|5:04
Outkast|Rosa Parks|5:24
Wu-Tang Clan|C.R.E.A.M.|4:12
Wu-Tang Clan|Protect Ya Neck|4:52
Notorious B.I.G.|Hypnotize|3:49
Notorious B.I.G.|Juicy|5:02
Notorious B.I.G.|Mo Money Mo Problems|4:17
2Pac|California Love|4:45
2Pac|Changes|4:29
2Pac|Dear Mama|4:41
Coolio|Gangsta's Paradise|4:00
Aqua|Barbie Girl|3:17
Aqua|Doctor Jones|3:22
Vengaboys|We Like to Party|3:43
Vengaboys|Boom, Boom, Boom, Boom!!|3:22
ATB|9 PM (Till I Come)|3:16
Sonique|It Feels So Good|3:58
Shaggy|It Wasn't Me|3:47
Shaggy|Angel|3:55
U2|Beautiful Day|4:06
U2|One|4:36
U2|With or Without You|4:56
U2|Stuck in a Moment You Can't Get Out Of|4:32
Oasis|Wonderwall|4:18
Oasis|Don't Look Back in Anger|4:48
Oasis|Champagne Supernova|7:27
Blur|Song 2|2:02
Blur|Girls & Boys|4:51
Blur|Tender|7:40
The Verve|Bitter Sweet Symphony|5:58
The Verve|The Drugs Don't Work|5:05
Garbage|Only Happy When It Rains|3:56
Garbage|Stupid Girl|4:18
No Doubt|Don't Speak|4:23
No Doubt|Just a Girl|3:29
No Doubt|Ex-Girlfriend|3:32
Alanis Morissette|Ironic|3:49
Alanis Morissette|You Oughta Know|4:09
Alanis Morissette|Hand in My Pocket|3:41
Hanson|MMMBop|4:28
Spice Girls|Wannabe|2:53
Spice Girls|Say You'll Be There|3:55
Spice Girls|2 Become 1|4:01
Celine Dion|My Heart Will Go On|4:40
Celine Dion|That's the Way It Is|4:01
Madison Avenue|Don't Call Me Baby|3:50
Modjo|Lady (Hear Me Tonight)|5:07
Mr. Oizo|Flat Beat|3:48
Bomfunk MC's|Freestyler|5:06
Alice Deejay|Better Off Alone|3:34
Stardust|Music Sounds Better with You|6:47
Robert Miles|Children|7:35
Faithless|Insomnia|8:43
Faithless|God Is a DJ|8:00
Underworld|Born Slippy .NUXX|9:44
The Chemical Brothers|Block Rockin' Beats|5:13
The Chemical Brothers|Hey Boy Hey Girl|4:50
Massive Attack|Teardrop|5:29
Massive Attack|Angel|6:19
Portishead|Glory Box|5:01
Portishead|Sour Times|4:11
Bjork|Army of Me|3:54
Bjork|Hyperballad|5:21
Prince|1999|6:15
Prince|Purple Rain|8:41
Michael Jackson|Billie Jean|4:54
Michael Jackson|Thriller|5:57
Michael Jackson|Smooth Criminal|4:17
Queen|Bohemian Rhapsody|5:55
Queen|We Will Rock You|2:01
Queen|Don't Stop Me Now|3:29
Led Zeppelin|Stairway to Heaven|8:02
Led Zeppelin|Whole Lotta Love|5:34
Led Zeppelin|Black Dog|4:55
Pink Floyd|Wish You Were Here|5:34
Pink Floyd|Another Brick in the Wall (Part 2)|3:59
Pink Floyd|Comfortably Numb|6:22
Pink Floyd|Money|6:22
The Beatles|Hey Jude|7:11
The Beatles|Let It Be|4:03
The Beatles|Yesterday|2:05
The Beatles|Come Together|4:19
The Rolling Stones|Paint It Black|3:22
The Rolling Stones|(I Can't Get No) Satisfaction|3:43
Jimi Hendrix|Purple Haze|2:50
Jimi Hendrix|All Along the Watchtower|4:00
The Doors|Light My Fire|7:06
The Doors|Riders on the Storm|7:14
Lynyrd Skynyrd|Sweet Home Alabama|4:43
Lynyrd Skynyrd|Free Bird|9:08
AC/DC|Back in Black|4:15
AC/DC|Highway to Hell|3:28
AC/DC|Thunderstruck|4:52
Guns N' Roses|Sweet Child o' Mine|5:56
Guns N' Roses|November Rain|8:57
Guns N' Roses|Welcome to the Jungle|4:31
Bon Jovi|It's My Life|3:44
Bon Jovi|Livin' on a Prayer|4:09
Aerosmith|I Don't Want to Miss a Thing|4:58
Aerosmith|Dream On|4:28
Pearl Jam|Alive|5:41
Pearl Jam|Jeremy|5:18
Pearl Jam|Last Kiss|3:17
Soundgarden|Black Hole Sun|5:18
Soundgarden|Spoonman|4:06
Alice in Chains|Man in the Box|4:46
Alice in Chains|Rooster|6:15
Stone Temple Pilots|Plush|5:13
Stone Temple Pilots|Interstate Love Song|3:14
Smashing Pumpkins|1979|4:25
Smashing Pumpkins|Tonight, Tonight|4:15
Smashing Pumpkins|Bullet with Butterfly Wings|4:18
Bush|Glycerine|4:26
Bush|Machinehead|4:16
Live|Lightning Crashes|5:25
Live|I Alone|3:49
Counting Crows|Mr. Jones|4:33
Counting Crows|A Long December|4:56
Goo Goo Dolls|Iris|4:49
Goo Goo Dolls|Slide|3:33
Goo Goo Dolls|Name|4:30
Hootie & the Blowfish|Hold My Hand|4:15
Hootie & the Blowfish|Only Wanna Be with You|3:46
Dave Matthews Band|Crash into Me|5:16
Dave Matthews Band|Ants Marching|4:31
Dave Matthews Band|Crush|8:09
Barenaked Ladies|One Week|2:50
Barenaked Ladies|Pinch Me|3:51
Fastball|The Way|4:17
Marcy Playground|Sex and Candy|2:53
Harvey Danger|Flagpole Sitta|3:38
Eagle-Eye Cherry|Save Tonight|3:59
Natalie Imbruglia|Torn|4:05
Shania Twain|Man! I Feel Like a Woman!|3:53
Shania Twain|You're Still the One|3:34
Shania Twain|That Don't Impress Me Much|3:38
Faith Hill|Breathe|4:10
LeAnn Rimes|How Do I Live|4:25
Dixie Chicks|Wide Open Spaces|3:44
Garth Brooks|Friends in Low Places|4:18
Tim McGraw|Something Like That|3:04
Jennifer Lopez|If You Had My Love|4:25
Jennifer Lopez|Waiting for Tonight|4:06
Mariah Carey|Fantasy|4:04
Mariah Carey|Heartbreaker|4:46
Mariah Carey|Always Be My Baby|4:18
Whitney Houston|I Will Always Love You|4:31
Whitney Houston|It's Not Right but It's Okay|4:51
Janet Jackson|Together Again|5:01
Janet Jackson|Doesn't Really Matter|4:16
Lauryn Hill|Doo Wop (That Thing)|5:20
Lauryn Hill|Ex-Factor|5:26
Fugees|Killing Me Softly|4:58
Fugees|Ready or Not|3:47
Missy Elliott|Get Ur Freak On|3:31
Missy Elliott|The Rain (Supa Dupa Fly)|4:11
Jay-Z|Hard Knock Life (Ghetto Anthem)|3:58
Jay-Z|Big Pimpin'|4:43
Nas|If I Ruled the World|4:42
DMX|Party Up (Up in Here)|4:28
DMX|Ruff Ryders' Anthem|3:33
Busta Rhymes|Woo Hah!! Got You All in Check|4:04
Busta Rhymes|Gimme Some More|2:37
Puff Daddy|I'll Be Missing You|5:03
Puff Daddy|It's All About the Benjamins|4:46
Nelly|Country Grammar|4:46
Nelly|Ride wit Me|4:51
Snoop Dogg|Gin and Juice|3:31
Snoop Dogg|Still a G Thang|4:28
Ice Cube|It Was a Good Day|4:20
Cypress Hill|Insane in the Brain|3:29
House of Pain|Jump Around|3:37
Sisqo|Thong Song|4:13
Sisqo|Incomplete|4:33
Usher|You Make Me Wanna...|3:39
Usher|Nice & Slow|3:46
R. Kelly|I Believe I Can Fly|5:21
Brandy & Monica|The Boy Is Mine|4:54
Aaliyah|Try Again|4:44
Aaliyah|Are You That Somebody?|4:27
Toni Braxton|He Wasn't Man Enough|4:21
Toni Braxton|Un-Break My Heart|4:31
Boyz II Men|End of the Road|5:50
Boyz II Men|I'll Make Love to You|4:07
K-Ci & JoJo|All My Life|5:20
Next|Too Close|4:20
Joe|I Wanna Know|4:56
Craig David|7 Days|3:55
Craig David|Fill Me In|4:17
Sade|By Your Side|4:34
Enrique Iglesias|Bailamos|3:35
Enrique Iglesias|Be with You|3:39
Marc Anthony|I Need to Know|4:04
Jessica Simpson|I Wanna Love You Forever|4:23
Mandy Moore|Candy|3:54
Jewel|You Were Meant for Me|4:13
Jewel|Hands|3:55
Sarah McLachlan|Angel|4:30
Sarah McLachlan|Building a Mystery|4:07
Sheryl Crow|All I Wanna Do|4:32
Sheryl Crow|If It Makes You Happy|5:23
Fiona Apple|Criminal|5:41
Paula Cole|I Don't Want to Wait|5:08
Meredith Brooks|Bitch|4:12
Lisa Loeb|Stay (I Missed You)|3:03
Gin Blossoms|Hey Jealousy|3:56
Toad the Wet Sprocket|All I Want|3:15
The Cranberries|Zombie|5:06
The Cranberries|Linger|4:34
The Cranberries|Dreams|4:31
Cake|The Distance|3:00
Cake|Never There|2:40
Cake|Short Skirt/Long Jacket|3:24
Beck|Loser|3:55
Beck|Where It's At|5:30
Beck|Sexx Laws|3:39
They Might Be Giants|Birdhouse in Your Soul|3:20
They Might Be Giants|Istanbul (Not Constantinople)|2:33
They Might Be Giants|Particle Man|2:00
They Might Be Giants|Boss of Me|2:51
Ween|Push th' Little Daisies|2:50
Primus|Jerry Was a Race Car Driver|3:11
Tool|Schism|6:47
Tool|Sober|5:06
Tool|Stinkfist|5:11
A Perfect Circle|Judith|4:07
Deftones|Change (In the House of Flies)|4:59
Deftones|My Own Summer (Shove It)|3:34
System of a Down|Sugar|2:33
System of a Down|Chop Suey!|3:30
Slipknot|Wait and Bleed|2:27
Slipknot|Spit It Out|2:39
Marilyn Manson|The Beautiful People|3:41
Marilyn Manson|The Dope Show|3:46
Marilyn Manson|Sweet Dreams (Are Made of This)|4:53
Nine Inch Nails|Closer|6:13
Nine Inch Nails|Hurt|6:13
Nine Inch Nails|The Day the World Went Away|4:33
Rob Zombie|Dragula|3:42
White Zombie|More Human than Human|4:28
Orgy|Blue Monday|4:30
Static-X|Push It|2:36
Disturbed|Down with the Sickness|4:38
Staind|Mudshovel|4:30
Kid Rock|Bawitdaba|4:26
Kid Rock|Cowboy|4:19
Lit|My Own Worst Enemy|2:49
Eve 6|Inside Out|3:39
Fuel|Shimmer|3:34
Fuel|Hemorrhage (In My Hands)|3:58
3 Doors Down|Kryptonite|3:53
3 Doors Down|Loser|4:24
Nickelback|Leader of Men|3:30
Incubus|Drive|3:52
Incubus|Pardon Me|3:44
311|Down|2:53
311|Amber|3:28
Sublime|What I Got|2:51
Sublime|Santeria|3:03
Sublime|Wrong Way|2:16
Reel Big Fish|Sell Out|3:47
Mighty Mighty Bosstones|The Impression That I Get|3:15
Save Ferris|Come On Eileen|3:36
Less Than Jake|All My Best Friends Are Metalheads|2:33
Lagwagon|Violins|2:27
NOFX|Linoleum|2:10
Bad Religion|21st Century (Digital Boy)|2:49
Rancid|Time Bomb|2:24
Jimmy Eat World|Lucky Denver Mint|3:40
New Found Glory|Hit or Miss|3:22
Sum 41|Fat Lip|2:59
Good Charlotte|Little Things|3:23
Mxpx|Responsibility|2:47
Unwritten Law|Seein' Red|3:35
Tonic|If You Could Only See|4:21
Collective Soul|Shine|5:05
Collective Soul|December|4:45
Candlebox|Far Behind|4:59
Seven Mary Three|Cumbersome|3:59
Silverchair|Tomorrow|4:26
Spacehog|In the Meantime|5:08
Presidents of the United States of America|Peaches|2:52
Presidents of the United States of America|Lump|2:14
Primitive Radio Gods|Standing Outside a Broken Phone Booth with Money in My Hand|5:41
Deep Blue Something|Breakfast at Tiffany's|4:18
Dishwalla|Counting Blue Cars|4:56
Nada Surf|Popular|3:44
Local H|Bound for the Floor|4:12
Stabbing Westward|Shame|4:19
Filter|Hey Man Nice Shot|5:15
Filter|Take a Picture|6:03
The Wallflowers|One Headlight|5:12
Duncan Sheik|Barely Breathing|4:13
Edwin McCain|I'll Be|4:28
Train|Meet Virginia|3:59
Train|Drops of Jupiter|4:20
Lifehouse|Hanging by a Moment|3:36
Nine Days|Absolutely (Story of a Girl)|3:08
Stroke 9|Little Black Backpack|3:23
Len|Steal My Sunshine|4:28
Wheatus|Teenage Dirtbag|4:01
SR-71|Right Now|2:47
American Hi-Fi|Flavor of the Weak|3:11
Dido|Thank You|3:38
Dido|Here with Me|4:14
Enya|Only Time|3:38
Enya|Orinoco Flow|4:26
Sixpence None the Richer|Kiss Me|3:18
The Corrs|Breathless|3:27
Texas|Say What You Want|3:53
Robbie Williams|Angels|4:25
Robbie Williams|Rock DJ|4:18
All Saints|Pure Shores|4:24
All Saints|Never Ever|6:27
S Club 7|Reach|4:00
Steps|Tragedy|4:30
Westlife|Swear It Again|4:07
Ronan Keating|When You Say Nothing at All|4:15
Geri Halliwell|It's Raining Men|4:18
Mel C|Never Be the Same Again|4:54
Anastacia|I'm Outta Love|4:05
Melanie B|Word Up|3:30
Basement Jaxx|Where's Your Head At|4:44
Basement Jaxx|Red Alert|4:16
Groove Armada|At the River|6:21
Groove Armada|I See You Baby|5:55
Moloko|Sing It Back|4:37
Leftfield|Release the Pressure|7:40
Orbital|Halcyon + On + On|9:27
Paul van Dyk|For an Angel|7:05
Tiesto|Flight 643|9:12
Sasha|Xpander|11:42
BT|Dreaming|6:09
Chicane|Saltwater|7:07
Energy 52|Cafe Del Mar|8:15
Binary Finary|1998|6:59
Fragma|Toca's Miracle|3:21
Spiller|Groovejet (If This Ain't Love)|3:47
Armand van Helden|You Don't Know Me|4:32
Gigi D'Agostino|L'Amour Toujours|6:59
DJ Sakin & Friends|Protect Your Mind (Braveheart)|3:41
Phats & Small|Turn Around|3:32
Wamdue Project|King of My Castle|3:31
Lucid|I Can't Help Myself|3:23
ATC|Around the World (La La La La La)|3:34
Baha Men|Who Let the Dogs Out|3:18
Los Del Rio|Macarena|4:12
Crazy Town|Butterfly|3:36
Bloodhound Gang|Fire Water Burn|4:56
Fountains of Wayne|Radiation Vibe|4:41
Ben Folds Five|Brick|4:31
Ben Folds Five|Army|3:24
Elliott Smith|Miss Misery|3:12
Jeff Buckley|Hallelujah|6:53
Ani DiFranco|32 Flavors|5:14
Tori Amos|Cornflake Girl|5:06
Tori Amos|Winter|5:42
PJ Harvey|Down by the Water|3:15
Pulp|Common People|5:51
Pulp|Disco 2000|4:33
Supergrass|Alright|3:01
Suede|Trash|4:06
Placebo|Pure Morning|4:16
Manic Street Preachers|If You Tolerate This Your Children Will Be Next|4:50
Stereophonics|Have a Nice Day|3:21
Travis|Why Does It Always Rain on Me?|4:25
Travis|Sing|3:48
Muse|Muscle Museum|4:23
Muse|Sunburn|3:54
Embrace|Come Back to What You Know|5:05
Ash|Girl from Mars|3:30
Feeder|Buck Rogers|3:13
The Cardigans|Lovefool|3:18
The Cardigans|My Favourite Game|3:37
Ace of Base|The Sign|3:09
Ace of Base|All That She Wants|3:31
Roxette|It Must Have Been Love|4:20
A-ha|Take On Me|3:46
Europe|The Final Countdown|5:10
Rednex|Cotton Eye Joe|3:12
Dr. Alban|It's My Life|4:01
Haddaway|What Is Love|4:30
2 Unlimited|Get Ready for This|3:44
Snap!|Rhythm Is a Dancer|5:32
Corona|The Rhythm of the Night|4:23
La Bouche|Be My Lover|4:00
Real McCoy|Another Night|3:58
Culture Beat|Mr. Vain|4:18
Captain Hollywood Project|More and More|4:13
Ice MC|Think About the Way|4:13
Scatman John|Scatman (Ski-Ba-Bop-Ba-Dop-Bop)|3:30
Mr. President|Coco Jamboo|3:37
Fool's Garden|Lemon Tree|3:11
Nena|99 Luftballons|3:53
Falco|Rock Me Amadeus|3:22
Rammstein|Du Hast|3:54
Rammstein|Engel|4:24
Rammstein|Sonne|4:32
In Flames|Only for the Weak|4:55
Iron Maiden|The Number of the Beast|4:50
Iron Maiden|Run to the Hills|3:53
Black Sabbath|Paranoid|2:48
Black Sabbath|Iron Man|5:56
Ozzy Osbourne|Crazy Train|4:56
Megadeth|Symphony of Destruction|4:02
Slayer|Raining Blood|4:14
Pantera|Walk|5:15
Pantera|Cowboys from Hell|4:06
Sepultura|Roots Bloody Roots|3:32
Weird Al Yankovic|Amish Paradise|3:20
Weird Al Yankovic|The Saga Begins|5:28
Weird Al Yankovic|It's All About the Pentiums|3:34
Adam Sandler|The Chanukah Song|3:46
Tenacious D|Tribute|4:08
Dynamite Hack|Boyz-n-the-Hood|3:15
`;
