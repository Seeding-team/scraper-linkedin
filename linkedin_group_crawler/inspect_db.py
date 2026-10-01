import pg8000.dbapi

def main():
    host = "db.rtwpogvficadngtfrcci.supabase.co"
    port = 6543
    user = "postgres"
    password = __import__("os").environ["SUPABASE_DB_PASSWORD"]
    database = "postgres"
    
    print(f"Connecting to database {database} on {host}:{port}...")
    conn = pg8000.dbapi.connect(
        host=host,
        port=port,
        user=user,
        password=password,
        database=database
    )
    cursor = conn.cursor()
    try:
        print("Executing ALTER TABLE to add is_friend column...")
        cursor.execute("ALTER TABLE zalo_groups ADD COLUMN IF NOT EXISTS is_friend BOOLEAN DEFAULT FALSE;")
        conn.commit()
        print("Success! is_friend column added successfully to zalo_groups.")
    except Exception as e:
        print(f"Error executing migration: {e}")
        conn.rollback()
    finally:
        cursor.close()
        conn.close()

if __name__ == '__main__':
    main()
