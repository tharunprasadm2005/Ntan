/**
 * 105 Sample Warehouse Products for Commercial Testing
 * Includes: Electrical, Mechanical, Bearings, Fasteners, Chemicals (Lot-tracked),
 * High-Value Equipment (Serial-tracked), Packaging, and Safety PPE.
 */
export const SAMPLE_PRODUCTS_CSV = `sku,name,barcode,category,item_type,base_uom,tracking_mode,expiry_tracked,reorder_point,cost,description
ELEC-CBL-001,Copper 4-Core Armoured Cable 50m,890100000001,Electrical,stocked_material,MTR,none,false,25.0,42.50,Heavy-duty industrial power distribution cable
ELEC-CBL-002,Cat6A Shielded Ethernet Cable 305m,890100000002,Electrical,stocked_material,BOX,none,false,10.0,110.00,High-speed gigabit ethernet network cabling
ELEC-CBL-003,Flexible Conduit 25mm 25m,890100000003,Electrical,stocked_material,ROLL,none,false,15.0,18.75,Corrugated PVC protective wire conduit
ELEC-BRK-001,Miniature Circuit Breaker 16A 1P,890100000004,Electrical,stocked_material,EA,none,false,30.0,6.20,DIN-rail mount 16A single pole breaker
ELEC-BRK-002,Moulded Case Circuit Breaker 100A 3P,890100000005,Electrical,stocked_material,EA,none,false,5.0,85.00,Industrial main distribution 3-phase breaker
ELEC-BRK-003,Residual Current Device 40A 30mA,890100000006,Electrical,stocked_material,EA,none,false,12.0,24.50,Earth leakage safety tripping device
ELEC-RLY-001,Industrial Relay 24VDC 8-Pin,890100000007,Electrical,stocked_material,EA,none,false,40.0,4.80,Plug-in electromagnetic control relay
ELEC-RLY-002,Solid State Relay 40A 240VAC,890100000008,Electrical,stocked_material,EA,none,false,15.0,14.50,Opto-isolated silent switching SSR
ELEC-PWR-001,DIN-Rail Power Supply 24V 5A,890100000009,Electrical,stocked_material,EA,none,false,8.0,48.00,Regulated switched-mode industrial power unit
ELEC-PWR-002,DIN-Rail Power Supply 24V 10A,890100000010,Electrical,stocked_material,EA,none,false,6.0,78.00,Heavy-duty 240W DC automation supply
ELEC-SEN-001,Inductive Proximity Sensor M12,890100000011,Sensors,stocked_material,EA,none,false,20.0,16.50,Non-contact metallic object detection sensor
ELEC-SEN-002,Photoelectric Retroreflective Sensor,890100000012,Sensors,stocked_material,EA,none,false,15.0,28.00,Long-range beam break conveyor sensor
ELEC-SEN-003,Ultrasonic Distance Sensor 0.5-3m,890100000013,Sensors,stocked_material,EA,none,false,8.0,64.00,Analog level and distance measuring sensor
ELEC-SEN-004,Thermocouple Type-K Probe 2m,890100000014,Sensors,stocked_material,EA,none,false,25.0,11.20,Stainless steel sheath temperature probe
ELEC-TER-001,Screw Terminal Blocks 2.5mm Gray,890100000015,Electrical,stocked_material,BOX,none,false,10.0,22.00,Pack of 100 DIN-rail terminal connectors
ELEC-TER-002,End Clamp Brackets for DIN Rail,890100000016,Electrical,stocked_material,PACK,none,false,15.0,8.50,Pack of 50 heavy duty stop brackets
MECH-BRG-001,Deep Groove Ball Bearing 6204-2RS,890100000017,Bearings,stocked_material,EA,none,false,50.0,4.10,Double sealed radial motor shaft bearing
MECH-BRG-002,Deep Groove Ball Bearing 6306-2RS,890100000018,Bearings,stocked_material,EA,none,false,30.0,7.80,Heavy series sealed drive shaft bearing
MECH-BRG-003,Pillow Block Unit UCP205 25mm,890100000019,Bearings,stocked_material,EA,none,false,16.0,15.50,Cast iron mounted pedestal bearing housing
MECH-BRG-004,Linear Motion Ball Bushing LM16UU,890100000020,Bearings,stocked_material,EA,none,false,24.0,5.60,Precision CNC linear shaft slide bearing
MECH-BLT-001,Timing Belt HTD 5M 15mm Width 500mm,890100000021,Power Transmission,stocked_material,EA,none,false,20.0,9.20,Reinforced fiberglass synchronous belt
MECH-BLT-002,V-Belt SPZ 1000 Drive Belt,890100000022,Power Transmission,stocked_material,EA,none,false,25.0,6.80,High-tensile friction transmission belt
MECH-CPL-001,Flexible Jaw Coupling 25mm x 14mm,890100000023,Power Transmission,stocked_material,EA,none,false,12.0,18.00,Shock-absorbing spider coupling unit
MECH-PNU-001,Pneumatic Cylinder 32mm Bore 100mm Stroke,890100000024,Pneumatics,stocked_material,EA,none,false,10.0,38.50,Double-acting magnetic piston air cylinder
MECH-PNU-002,Pneumatic Cylinder 50mm Bore 200mm Stroke,890100000025,Pneumatics,stocked_material,EA,none,false,6.0,62.00,High-thrust automated pusher cylinder
MECH-PNU-003,Solenoid Valve 5/2 Way 24VDC G1/4,890100000026,Pneumatics,stocked_material,EA,none,false,14.0,29.00,Directional pneumatic air control valve
MECH-PNU-004,Air Filter Regulator Lubricator Unit G3/8,890100000027,Pneumatics,stocked_material,SET,none,false,8.0,45.00,Modular compressed air FRL treatment trio
MECH-PNU-005,Polyurethane Air Tubing 8mm Blue 100m,890100000028,Pneumatics,stocked_material,ROLL,none,false,5.0,26.00,High-flexibility pneumatic air hose
MECH-PNU-006,Push-In Quick Fitting 8mm x G1/4 Male,890100000029,Pneumatics,stocked_material,PACK,none,false,12.0,12.50,Pack of 10 brass nickel-plated connectors
MECH-MTR-001,Three-Phase AC Motor 0.75kW 1400RPM,890100000030,Motors,stocked_material,EA,serial,false,4.0,145.00,Standard flange-mount induction motor
MECH-MTR-002,High-Torque Stepper Motor NEMA 34,890100000031,Motors,stocked_material,EA,serial,false,8.0,68.00,Microstepping positioning hybrid motor
MECH-MTR-003,Brushless Servo Motor 750W With Encoder,890100000032,Motors,stocked_material,EA,serial,false,3.0,280.00,Precision automation rotary servo drive
MECH-MTR-004,Worm Gearbox Ratio 20:1 Size 50,890100000033,Motors,stocked_material,EA,none,false,5.0,89.00,Right-angle hollow shaft speed reducer
FAST-BLT-001,Hex Head Bolt M8 x 25mm Grade 8.8,890100000034,Fasteners,stocked_material,BOX,none,false,20.0,12.00,Zinc plated high-tensile bolt box of 200
FAST-BLT-002,Hex Head Bolt M10 x 40mm Grade 8.8,890100000035,Fasteners,stocked_material,BOX,none,false,15.0,18.50,Zinc plated heavy hex bolt box of 100
FAST-BLT-003,Hex Head Bolt M12 x 50mm Grade 8.8,890100000036,Fasteners,stocked_material,BOX,none,false,12.0,22.00,Structural frame bolt box of 50
FAST-SCR-001,Socket Cap Screw M6 x 20mm SS304,890100000037,Fasteners,stocked_material,BOX,none,false,25.0,14.00,Stainless steel allen head screw box of 100
FAST-SCR-002,Socket Cap Screw M8 x 30mm SS304,890100000038,Fasteners,stocked_material,BOX,none,false,20.0,17.50,Corrosion resistant machine screw box of 100
FAST-SCR-003,Socket Countersunk Screw M5 x 16mm,890100000039,Fasteners,stocked_material,BOX,none,false,30.0,9.80,Flat head flush mount screw box of 100
FAST-NUT-001,Nylon Insert Lock Nut M8 Galvanized,890100000040,Fasteners,stocked_material,BOX,none,false,25.0,7.50,Vibration proof lock nut box of 200
FAST-NUT-002,Nylon Insert Lock Nut M10 Galvanized,890100000041,Fasteners,stocked_material,BOX,none,false,20.0,11.00,Self-locking hex nut box of 100
FAST-NUT-003,Standard Hex Nut M12 Grade 8,890100000042,Fasteners,stocked_material,BOX,none,false,18.0,9.50,Carbon steel hex nut box of 100
FAST-WSH-001,Flat Form A Washer M8 Zinc,890100000043,Fasteners,stocked_material,BOX,none,false,30.0,5.20,General purpose load washer box of 500
FAST-WSH-002,Flat Form A Washer M10 Zinc,890100000044,Fasteners,stocked_material,BOX,none,false,25.0,7.80,Bright zinc plated washer box of 250
FAST-WSH-003,Spring Split Lock Washer M12,890100000045,Fasteners,stocked_material,BOX,none,false,20.0,6.90,Helical spring tension washer box of 200
FAST-ANC-001,Through Bolt Anchor M12 x 100mm,890100000046,Fasteners,stocked_material,BOX,none,false,10.0,28.00,Concrete floor expansion anchor box of 25
FAST-ANC-002,Drop-In Internal Anchor M10,890100000047,Fasteners,stocked_material,BOX,none,false,15.0,16.00,Female threaded flush masonry anchor box of 50
FAST-RVT-001,Blind Pop Rivet 4.8mm x 12mm Aluminum,890100000048,Fasteners,stocked_material,BOX,none,false,20.0,11.50,Dome head sheet metal rivet box of 500
CHEM-OIL-001,Hydraulic Oil ISO VG 46 20L Drum,890100000049,Chemicals,stocked_material,DRUM,lot,true,10.0,68.00,Anti-wear hydraulic system fluid lot tracked
CHEM-OIL-002,Synthetic Industrial Gear Oil ISO 220 20L,890100000050,Chemicals,stocked_material,DRUM,lot,true,8.0,92.00,Extreme pressure enclosed gear lubricant
CHEM-GRS-001,Lithium EP2 Multi-Purpose Grease 400g,890100000051,Chemicals,stocked_material,TUBE,lot,true,40.0,3.60,Universal bearing lubrication grease cartridge
CHEM-GRS-002,Food Grade Silicone Grease 500g,890100000052,Chemicals,stocked_material,TUB,lot,true,12.0,18.20,NSF H1 registered food machinery grease
CHEM-ADH-001,Threadlocker High Strength 50ml,890100000053,Chemicals,stocked_material,BOTTLE,lot,true,25.0,14.80,Anaerobic stud and bolt locking compound
CHEM-ADH-002,Retaining Compound Cylindrical Joints 50ml,890100000054,Chemicals,stocked_material,BOTTLE,lot,true,20.0,16.50,Bearing press-fit sleeve gap filler
CHEM-ADH-003,Structural Epoxy Adhesive 50ml Dual Cartridge,890100000055,Chemicals,stocked_material,TUBE,lot,true,18.0,12.00,Two-part high shear strength epoxy resin
CHEM-CLN-001,Fast Dry Electronic Contact Cleaner 400ml,890100000056,Chemicals,stocked_material,CAN,lot,true,30.0,6.50,Zero residue precision circuit spray cleaner
CHEM-CLN-002,Heavy Duty Machine Degreaser 5L,890100000057,Chemicals,stocked_material,CAN,lot,true,15.0,22.00,Biodegradable workshop floor and parts wash
CHEM-PNT-001,Safety Yellow Epoxy Floor Paint 5L,890100000058,Chemicals,stocked_material,CAN,lot,true,6.0,54.00,Aisle demarcation floor coating
RAW-ALU-001,Aluminum T-Slot Extrusion 40x40 3m,890100000059,Raw Materials,stocked_material,BAR,none,false,15.0,28.00,Modular machine building structural profile
RAW-ALU-002,Aluminum T-Slot Extrusion 40x80 3m,890100000060,Raw Materials,stocked_material,BAR,none,false,10.0,48.00,Heavy beam modular automation frame section
RAW-ALU-003,Aluminum Sheet 6061-T6 2mm 1m x 2m,890100000061,Raw Materials,stocked_material,SHEET,none,false,8.0,62.00,Aircraft grade structural aluminum sheet
RAW-STL-001,Mild Steel Hollow Section 50x50x3mm 6m,890100000062,Raw Materials,stocked_material,BAR,none,false,12.0,38.00,Square structural steel tubing
RAW-STL-002,Stainless Steel Round Bar 304 25mm 3m,890100000063,Raw Materials,stocked_material,BAR,none,false,10.0,45.00,Turned and ground corrosion-resistant shaft
RAW-STL-003,Perforated Galvanized Sheet 1.5mm 1m x 2m,890100000064,Raw Materials,stocked_material,SHEET,none,false,6.0,42.00,Protective safety guard punched metal panel
RAW-BRS-001,Brass Hexagonal Rod CZ121 19mm 2m,890100000065,Raw Materials,stocked_material,BAR,none,false,8.0,34.00,Free-machining fitting manufacture brass
RAW-PLM-001,Delrin Acetal Plate 20mm 500mm x 1000mm,890100000066,Raw Materials,stocked_material,SHEET,none,false,5.0,58.00,Low-friction wear strip engineering plastic
RAW-PLM-002,Ultra High Molecular Polyethylene Sheet 10mm,890100000067,Raw Materials,stocked_material,SHEET,none,false,6.0,46.00,Chute and hopper abrasion resistant liner
TOOL-SCN-001,Industrial 2D Barcode Scanner Bluetooth,890100000068,Equipment,stocked_material,EA,serial,false,4.0,165.00,Rugged IP65 warehouse mobile ring scanner
TOOL-SCN-002,Fixed Mount Barcode Reader EtherNet/IP,890100000069,Equipment,stocked_material,EA,serial,false,2.0,390.00,Conveyor tracking automated optical scanner
TOOL-TRQ-001,Digital Torque Wrench 20-200Nm 1/2in,890100000070,Equipment,stocked_material,EA,serial,false,3.0,180.00,Calibrated precision fastener torque tool
TOOL-MTR-001,Digital Clamp Multimeter True-RMS 600V,890100000071,Equipment,stocked_material,EA,serial,false,5.0,95.00,Electrical diagnostic AC/DC clamp tester
TOOL-PRN-001,Direct Thermal Barcode Label Printer 4in,890100000072,Equipment,stocked_material,EA,serial,false,3.0,240.00,High-speed dispatch and bin label printer
TOOL-SCL-001,Platform Floor Scale 500kg x 0.1kg,890100000073,Equipment,stocked_material,EA,serial,false,2.0,420.00,Heavy-duty inbound receiving platform scale
TOOL-BAT-001,LiFePO4 Forklift Battery Pack 48V 100Ah,890100000074,Equipment,stocked_material,EA,serial,false,1.0,1200.00,High-cycle warehouse AGV power pack
TOOL-AIR-001,Pneumatic Impact Wrench 1/2in Composite,890100000075,Tools,stocked_material,EA,serial,false,4.0,115.00,Twin-hammer high-speed mechanical air gun
TOOL-HND-001,Insulated Screwdriver Set 1000V 7pc,890100000076,Tools,stocked_material,SET,none,false,10.0,28.00,VDE certified electricians screwdriver toolkit
TOOL-HND-002,Metric Combination Spanner Set 6-24mm 16pc,890100000077,Tools,stocked_material,SET,none,false,8.0,42.00,Chrome vanadium high-strength wrench kit
PACK-BOX-001,Single Wall Corrugated Box 300x200x150mm,890100000078,Packaging,stocked_material,PACK,none,false,40.0,14.50,Pack of 25 shipping cartons
PACK-BOX-002,Double Wall Corrugated Box 450x300x300mm,890100000079,Packaging,stocked_material,PACK,none,false,30.0,26.00,Pack of 15 heavy duty export boxes
PACK-BOX-003,Heavy Duty Pallet Box 1200x800x800mm,890100000080,Packaging,stocked_material,EA,none,false,15.0,18.00,Euro-pallet footprint bulk distribution sleeve
PACK-WRP-001,Clear Stretch Film Pallet Wrap 500mm 23mic,890100000081,Packaging,stocked_material,BOX,none,false,20.0,32.00,Box of 6 extended core manual wrap rolls
PACK-WRP-002,Machine Cast Stretch Film 500mm 16kg,890100000082,Packaging,stocked_material,ROLL,none,false,10.0,48.00,High-yield puncture resistant machine film
PACK-BBL-001,Heavy Duty Bubble Wrap Roll 1200mm x 100m,890100000083,Packaging,stocked_material,ROLL,none,false,8.0,29.50,Large bubble shock-absorbent cushioning
PACK-TAP-001,Brown Packaging Tape 48mm x 66m Low Noise,890100000084,Packaging,stocked_material,BOX,none,false,15.0,24.00,Box of 36 solvent adhesive sealing tape
PACK-TAP-002,Hazard Warning Caution Tape 50mm x 33m,890100000085,Packaging,stocked_material,ROLL,none,false,12.0,5.80,Yellow and black striped self-adhesive vinyl
PACK-STP-001,Polypropylene Strapping Band 12mm 2000m,890100000086,Packaging,stocked_material,ROLL,none,false,6.0,38.00,Embossed pallet security strapping coil
PACK-STP-002,Semi-Open Metal Strapping Seals 12mm,890100000087,Packaging,stocked_material,BOX,none,false,10.0,14.20,Box of 1000 galvanized crimp seals
PACK-ENV-001,Docu-Pouch Document Enclosed Wallets A5,890100000088,Packaging,stocked_material,BOX,none,false,12.0,16.00,Box of 1000 clear adhesive packing list slips
PACK-LBL-001,Thermal Shipping Labels 4x6in 500/Roll,890100000089,Packaging,stocked_material,PACK,none,false,20.0,18.50,Pack of 4 rolls perforated shipping labels
SAFE-GLV-001,PU Coated Work Gloves Size 9 Large,890100000090,Safety,stocked_material,PACK,none,false,25.0,12.50,Pack of 10 pairs abrasion resistant gloves
SAFE-GLV-002,Cut Level 5 Kevlar Work Gloves Size 10,890100000091,Safety,stocked_material,PACK,none,false,15.0,34.00,Pack of 5 pairs metal and glass handling gloves
SAFE-GLV-003,Heavy Chemical Nitrile Gauntlets 330mm,890100000092,Safety,stocked_material,PAIR,none,false,20.0,4.80,Solvent and acid resistant green gauntlets
SAFE-EYE-001,Clear Anti-Scratch Safety Glasses,890100000093,Safety,stocked_material,PACK,none,false,15.0,16.00,Pack of 10 optical grade polycarbonate spectacles
SAFE-EYE-002,Chemical Splash Vented Safety Goggles,890100000094,Safety,stocked_material,EA,none,false,20.0,5.20,Wide-vision indirect ventilation eye protection
SAFE-EAR-001,Ear Defenders SNR 32dB Adjustable,890100000095,Safety,stocked_material,EA,none,false,12.0,11.50,High noise industrial over-head ear muffs
SAFE-EAR-002,Disposable PU Ear Plugs 37dB Dispenser Box,890100000096,Safety,stocked_material,BOX,none,false,8.0,22.00,Box of 200 pairs uncorded foam earplugs
SAFE-HLM-001,Vented Hard Hat Safety Helmet White,890100000097,Safety,stocked_material,EA,none,false,15.0,9.20,Ratchet harness overhead shock safety helmet
SAFE-HLM-002,Vented Hard Hat Safety Helmet Yellow,890100000098,Safety,stocked_material,EA,none,false,15.0,9.20,High-visibility warehouse operative helmet
SAFE-RES-001,FFP3 Valved Dust Mask Particulate Filter,890100000099,Safety,stocked_material,BOX,none,false,15.0,26.00,Box of 10 high-protection respirators
SAFE-VES-001,High-Vis Yellow Safety Vest Class 2 L,890100000100,Safety,stocked_material,PACK,none,false,20.0,14.00,Pack of 5 reflective strip safety waistcoats
SAFE-VES-002,High-Vis Orange Safety Vest Class 2 XL,890100000101,Safety,stocked_material,PACK,none,false,20.0,14.00,Pack of 5 logistics operative safety waistcoats
SAFE-AID-001,Warehouse First Aid Kit Wall Mounted 50-Person,890100000102,Safety,stocked_material,EA,none,false,3.0,45.00,BS-8599 compliant complete emergency medical kit
SAFE-SPI-001,Oil & Fuel Spill Kit 50 Litre Capacity,890100000103,Safety,stocked_material,BAG,none,false,4.0,62.00,Hydrocarbon absorbent pads and boom kit
SAFE-EXT-001,CO2 Fire Extinguisher 2kg With Horn,890100000104,Safety,stocked_material,EA,none,false,5.0,38.00,Class B and electrical equipment fire cylinder
SAFE-EXT-002,ABC Dry Powder Extinguisher 6kg,890100000105,Safety,stocked_material,EA,none,false,6.0,42.00,Multi-purpose warehouse area fire extinguisher`;
