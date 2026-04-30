/**
 * Route Mapper - Maps all API routes to database tables/columns
 * This script analyzes all route files and extracts:
 * - Route paths and HTTP methods
 * - Database tables and columns accessed
 * - SQL queries performed
 */

import * as fs from 'fs';
import * as path from 'path';

interface RouteMapping {
  method: string;
  path: string;
  file: string;
  tables: string[];
  columns: Set<string>;
  description: string;
}

const API_ROUTES_DIR = path.join(process.cwd(), 'apps/api/src/routes');

// Extract route information from a route file
function analyzeRouteFile(filePath: string): RouteMapping[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const fileName = path.basename(filePath);
  const routeMappings: RouteMapping[] = [];

  // Extract HTTP method patterns
  const methodRegex = /fastify\.(get|post|put|patch|delete)\s*\(\s*["']([^"']+)["']/g;
  let match;

  while ((match = methodRegex.exec(content)) !== null) {
    const method = match[1].toUpperCase();
    const routePath = match[2];

    // Extract table names from SQL queries
    const tables = new Set<string>();
    const columns = new Set<string>();

    // Find table references in FROM, JOIN, INSERT INTO, UPDATE clauses
    const fromRegex = /FROM\s+(\w+)/gi;
    const joinRegex = /JOIN\s+(\w+)/gi;
    const insertRegex = /INSERT\s+INTO\s+(\w+)/gi;
    const updateRegex = /UPDATE\s+(\w+)/gi;
    const deleteRegex = /DELETE\s+FROM\s+(\w+)/gi;

    [fromRegex, joinRegex, insertRegex, updateRegex, deleteRegex].forEach(regex => {
      let tableMatch;
      while ((tableMatch = regex.exec(content)) !== null) {
        tables.add(tableMatch[1]);
      }
    });

    // Extract column references
    const selectRegex = /SELECT\s+([^FROM]+)\s+FROM/gi;
    let selectMatch;
    while ((selectMatch = selectRegex.exec(content)) !== null) {
      const columnsPart = selectMatch[1];
      const colMatches = columnsPart.match(/\w+\.\w+|\w+/g);
      if (colMatches) {
        colMatches.forEach(col => {
          if (!['SELECT', 'COUNT', 'MAX', 'MIN', 'AVG', 'SUM', 'AS'].includes(col.toUpperCase())) {
            columns.add(col);
          }
        });
      }
    }

    routeMappings.push({
      method,
      path: routePath,
      file: fileName,
      tables: Array.from(tables),
      columns,
      description: `${method} ${routePath}`,
    });
  }

  return routeMappings;
}

// Main function
function main() {
  console.log('🔍 Analyzing API routes...\n');

  const routeFiles = fs.readdirSync(API_ROUTES_DIR).filter(file => file.endsWith('.ts'));

  const allMappings: RouteMapping[] = [];

  routeFiles.forEach(file => {
    const filePath = path.join(API_ROUTES_DIR, file);
    const mappings = analyzeRouteFile(filePath);
    allMappings.push(...mappings);
    console.log(`✅ Analyzed: ${file} (${mappings.length} routes)`);
  });

  console.log(`\n📊 Total routes analyzed: ${allMappings.length}\n`);

  // Generate markdown report
  let report = '# API Routes to Database Mapping\n\n';
  report += `**Generated**: ${new Date().toISOString()}\n`;
  report += `**Total Routes**: ${allMappings.length}\n\n`;

  // Group by file
  const groupedByFile = allMappings.reduce((acc, mapping) => {
    if (!acc[mapping.file]) {
      acc[mapping.file] = [];
    }
    acc[mapping.file].push(mapping);
    return acc;
  }, {} as Record<string, RouteMapping[]>);

  Object.entries(groupedByFile).forEach(([file, mappings]) => {
    report += `## ${file}\n\n`;
    mappings.forEach(mapping => {
      report += `### ${mapping.method} ${mapping.path}\n\n`;
      report += `- **Tables**: ${mapping.tables.join(', ') || 'None detected'}\n`;
      report += `- **Sample Columns**: ${Array.from(mapping.columns).slice(0, 10).join(', ')}\n\n`;
    });
  });

  // Save report
  const reportPath = path.join(process.cwd(), 'API_ROUTES_MAPPING.md');
  fs.writeFileSync(reportPath, report, 'utf-8');
  console.log(`📄 Report saved to: ${reportPath}`);
}

main();



