import pg8000.dbapi

def main():
    host = "db.rtwpogvficadngtfrcci.supabase.co"
    port = 6543
    user = "postgres"
    password = __import__("os").environ["SUPABASE_DB_PASSWORD"]
    database = "postgres"
    
    conn = pg8000.dbapi.connect(
        host=host,
        port=port,
        user=user,
        password=password,
        database=database
    )
    cursor = conn.cursor()
    try:
        # Get indexes
        cursor.execute("""
            SELECT indexname, indexdef 
            FROM pg_indexes 
            WHERE tablename = 'zalo_messages';
        """)
        print("Indexes on zalo_messages:")
        for row in cursor.fetchall():
            print(f"- Name: {row[0]} | Def: {row[1]}")
            
        # Get unique constraints
        cursor.execute("""
            SELECT conname, pg_get_constraintdef(oid)
            FROM pg_constraint
            WHERE conrelid = 'public.zalo_messages'::regclass;
        """)
        print("\nConstraints on zalo_messages:")
        for row in cursor.fetchall():
            print(f"- Name: {row[0]} | Def: {row[1]}")
            
    except Exception as e:
        print(f"Error: {e}")
    finally:
        cursor.close()
        conn.close()

if __name__ == '__main__':
    main()
