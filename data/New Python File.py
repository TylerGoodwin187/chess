import sqlite3
import os

TARGET_SIZE_KB = 95000

DATABASES = [
    "puzzles_0100_0800.db",
    "puzzles_0801_1000.db",
    "puzzles_1001_1200.db",
    "puzzles_1201_1400.db",
    "puzzles_1401_1600.db",
    "puzzles_1601_1800.db",
    "puzzles_1801_2000.db",
    "puzzles_2001_2200.db",
    "puzzles_2201_2400.db",
    "puzzles_2401_+.db"
]

DELETE_BATCH = 10000

for filename in DATABASES:

    if not os.path.exists(filename):
        print(f"{filename} not found.")
        continue

    print(f"\nProcessing {filename}")

    while True:

        size_kb = os.path.getsize(filename) / 1024
        print(f"Current size: {size_kb:,.0f} KB")

        if size_kb <= TARGET_SIZE_KB:
            print("Finished.")
            break

        conn = sqlite3.connect(filename)
        cur = conn.cursor()

        cur.execute(f"""
            DELETE FROM puzzles
            WHERE rowid IN (
                SELECT rowid
                FROM puzzles
                ORDER BY RANDOM()
                LIMIT {DELETE_BATCH}
            )
        """)

        deleted = cur.rowcount

        conn.commit()

        print(f"Deleted {deleted:,} puzzles")

        print("Vacuuming...")
        cur.execute("VACUUM")

        conn.close()

print("\nAll databases finished.")

input("\nPress Enter to close...")