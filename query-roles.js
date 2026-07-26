const { createClient } = require('@supabase/supabase-js');

async function getRoles() {
  const supabase = createClient(
    'https://ykjswipxwupkrpobovko.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlranN3aXB4d3Vwa3Jwb2JvdmtvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE5NTQ5NzAsImV4cCI6MjA2NzUzMDk3MH0.Si7akBihpL06J20WFMnjLaL61lDqldDoO9k-kHaBGd4'
  );

  // First get all roles from tenant.roles
  const { data: roles, error: rolesError } = await supabase
    .schema('tenant')
    .from('roles')
    .select('*');

  if (rolesError) {
    console.error('Error fetching roles:', rolesError);
    return;
  }

  console.log('=== Configured Roles ===\n');
  if (roles && roles.length > 0) {
    console.log(`Total roles configured: ${roles.length}\n`);
    roles.forEach((role, index) => {
      console.log(`${index + 1}. Name: ${role.name}`);
      console.log(`   ID: ${role.id}`);
      console.log(`   Description: ${role.description || '(none)'}`);
      console.log(`   Created: ${role.created_at}`);
      console.log(`   Updated: ${role.updated_at}`);
      console.log();
    });
  } else {
    console.log('No custom roles configured yet.');
  }

  // Also get user count per role
  const { data: userRoles, error: userError } = await supabase
    .schema('tenant')
    .from('roles')
    .select(`id, name, system_users!inner(id)`);

  if (!userError && userRoles) {
    console.log('=== Users per Role ===\n');
    userRoles.forEach(role => {
      const userCount = role.system_users ? role.system_users.length : 0;
      console.log(`${role.name}: ${userCount} user(s)`);
    });
  }
}

getRoles().catch(console.error);
