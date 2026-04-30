import { FastifyInstance } from "fastify";
import { Pool } from "pg";
import { createReceiptGeneratorService } from "../services/receipt-generator.service";
import { promises as fs } from 'fs';
import { join } from 'path';

export async function receiptsRoutes(fastify: FastifyInstance) {
  const pool = fastify.pg as Pool;
  const receiptService = createReceiptGeneratorService();

  // POST /api/v1/receipts/generate/:transactionId - Generate receipt for transaction
  fastify.post("/generate/:transactionId", {
    schema: {
      params: {
        type: "object",
        required: ["transactionId"],
        properties: {
          transactionId: { type: "string", format: "uuid" },
        },
      },
      querystring: {
        type: "object",
        properties: {
          language: { type: "string", enum: ["fr", "en"], default: "fr" },
          format: { type: "string", enum: ["html", "pdf"], default: "html" },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const { transactionId } = request.params as { transactionId: string };
      const { language = "fr", format = "html" } = request.query as any;
      const client = await pool.connect();

      try {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [request.tenantId]);

        // Get transaction details with student and tenant info
        const transactionQuery = `
          SELECT 
            pt.*,
            sp.student_number,
            u.first_name || ' ' || u.last_name as student_name,
            se.fees,
            ay.name as academic_year_name,
            c.name as class_name,
            c.programme_id,
            p.cycle_id,
            t.name as tenant_name,
            COALESCE(t.settings_json->>'address', '') as tenant_address,
            COALESCE(t.settings_json->>'phone', '') as tenant_phone,
            COALESCE(t.settings_json->>'email', '') as tenant_email,
            COALESCE(t.settings_json->>'logo_url', '') as tenant_logo
          FROM payment_transactions pt
          JOIN student_profiles sp ON pt.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          JOIN student_enrollments se ON pt.enrollment_id = se.id
          JOIN academic_years ay ON se.academic_year_id = ay.id
          LEFT JOIN classes c ON se.class_id = c.id
          LEFT JOIN programmes p ON p.id = c.programme_id
          JOIN tenants t ON pt.tenant_id = t.id
          WHERE pt.id = $1 AND pt.tenant_id = $2 AND pt.status = 'completed'
        `;

        const transactionResult = await client.query(transactionQuery, [
          transactionId,
          request.tenantId,
        ]);

        if (transactionResult.rows.length === 0) {
          return reply.status(404).send({
            error: "Not Found",
            message: "Completed transaction not found",
          });
        }

        const transaction = transactionResult.rows[0];

        // Check if receipt already exists
        const existingReceiptQuery = `
          SELECT * FROM payment_receipts 
          WHERE transaction_id = $1 AND tenant_id = $2
        `;

        const existingReceiptResult = await client.query(existingReceiptQuery, [
          transactionId,
          request.tenantId,
        ]);

        let receiptNumber: string;
        let receiptUrl: string;

        if (existingReceiptResult.rows.length > 0) {
          // Use existing receipt
          const existingReceipt = existingReceiptResult.rows[0];
          receiptNumber = existingReceipt.receipt_number;
          receiptUrl = existingReceipt.receipt_url;
          console.log('Using existing receipt:', { receiptNumber, receiptUrl });
          
          // Validate receipt number format (should be REC + year (4 digits) + 6 digits)
          const isValidFormat = receiptNumber && /^REC\d{4}\d{6}$/.test(receiptNumber);
          
          // If receipt number is empty or invalid format, regenerate it
          if (!receiptNumber || receiptNumber.trim() === '' || !isValidFormat) {
            console.warn('Existing receipt has invalid receipt_number format, regenerating...', receiptNumber);
            // Fall through to generate new receipt number
          } else {
            // Check if receipt URL is valid (contains the receipt number)
            if (!receiptUrl || !receiptUrl.includes(receiptNumber)) {
              console.warn('Existing receipt has invalid URL, updating it...');
              // Update the URL to include the receipt number
              if (format === "pdf") {
                receiptUrl = `/api/v1/files/receipts/${receiptNumber}.pdf`;
              } else {
                receiptUrl = `/api/v1/files/receipts/${receiptNumber}.html`;
              }
              
              // Update the receipt URL in database
              await client.query(
                `UPDATE payment_receipts 
                 SET receipt_url = $1 
                 WHERE transaction_id = $2 AND tenant_id = $3`,
                [receiptUrl, transactionId, request.tenantId]
              );
              
              // Also update transaction
              await client.query(
                "UPDATE payment_transactions SET receipt_url = $1 WHERE id = $2",
                [receiptUrl, transactionId]
              );
              
              console.log('Updated receipt URL to:', receiptUrl);
            }
            
            // Check if the actual file exists on disk
            const possibleBaseDirs = [];
            if (process.env.FILE_STORAGE_PATH) {
              possibleBaseDirs.push(process.env.FILE_STORAGE_PATH);
            }
            const backendUploadsDir = join(process.cwd(), 'uploads');
            possibleBaseDirs.push(backendUploadsDir);
            const webUploadsDir = join(process.cwd(), '..', 'web', 'uploads');
            possibleBaseDirs.push(webUploadsDir);
            
            const fileExtension = format === "pdf" ? ".pdf" : ".html";
            const fileName = `${receiptNumber}${fileExtension}`;
            let fileExists = false;
            
            for (const baseDir of possibleBaseDirs) {
              const filePath = join(baseDir, 'receipts', fileName);
              try {
                await fs.access(filePath);
                fileExists = true;
                console.log('Receipt file exists at:', filePath);
                break;
              } catch {
                // File not found at this path, try next
                continue;
              }
            }
            
            if (!fileExists) {
              console.warn('Receipt file does not exist, regenerating...');
              // Fall through to regenerate the receipt
            } else {
              // Force regeneration to always apply latest template updates
              console.log('Receipt file exists but will be regenerated with latest template:', receiptNumber);
            }
          }
        }
        
        // Generate new receipt (or regenerate if existing was empty)
        {
          // Generate receipt number first using SQL function (only if none already exists)
          if (!receiptNumber) {
            try {
              const receiptNumberResult = await client.query(
                "SELECT generate_receipt_number($1) as receipt_number",
                [request.tenantId]
              );
              receiptNumber = receiptNumberResult.rows[0]?.receipt_number;
              console.log('Receipt number from SQL function:', receiptNumber);
              
              // Validate receipt number format (should be REC + year (4 digits) + 6 digits)
              // Example: REC2025000001
              if (receiptNumber && !/^REC\d{4}\d{6}$/.test(receiptNumber)) {
                console.warn('Invalid receipt number format from SQL function, regenerating:', receiptNumber);
                receiptNumber = null;
              }
              
              // Fallback if function doesn't exist or returns null or invalid format
              if (!receiptNumber) {
                const year = new Date().getFullYear();
                // Extract only the last 6 digits (sequence number) from existing receipts
                const countResult = await client.query(
                  `SELECT COALESCE(MAX(CAST(RIGHT(receipt_number, 6) AS INTEGER)), 0) + 1 as next_num
                   FROM payment_receipts
                   WHERE tenant_id = $1 AND receipt_number LIKE $2 AND LENGTH(receipt_number) = 14`,
                  [request.tenantId, `REC${year}%`]
                );
                const nextNum = countResult.rows[0]?.next_num || 1;
                // Ensure nextNum doesn't exceed 6 digits
                const sequenceNum = Math.min(nextNum, 999999);
                receiptNumber = `REC${year}${String(sequenceNum).padStart(6, '0')}`;
                console.log('Generated receipt number manually:', receiptNumber);
              }
            } catch (error: any) {
              // If function doesn't exist or fails, generate manually
              console.warn('generate_receipt_number function error, using manual generation:', error.message);
              const year = new Date().getFullYear();
              
              try {
                // Extract only the last 6 digits (sequence number) from existing receipts
                // Use a subquery with error handling to ignore invalid receipt numbers
                const countResult = await client.query(
                  `SELECT COALESCE(MAX(sequence_num), 0) + 1 as next_num
                   FROM (
                     SELECT 
                       CASE 
                         WHEN LENGTH(receipt_number) = 14 
                         AND receipt_number ~ '^REC\\d{4}\\d{6}$'
                         THEN CAST(RIGHT(receipt_number, 6) AS INTEGER)
                         ELSE NULL
                       END as sequence_num
                     FROM payment_receipts
                     WHERE tenant_id = $1 AND receipt_number LIKE $2
                   ) valid_receipts
                   WHERE sequence_num IS NOT NULL`,
                  [request.tenantId, `REC${year}%`]
                );
                const nextNum = countResult.rows[0]?.next_num || 1;
                // Ensure nextNum doesn't exceed 6 digits
                const sequenceNum = Math.min(nextNum, 999999);
                receiptNumber = `REC${year}${String(sequenceNum).padStart(6, '0')}`;
                console.log('Generated receipt number manually (fallback):', receiptNumber);
              } catch (fallbackError: any) {
                // If even the fallback fails, use a simple increment
                console.error('Fallback generation also failed, using simple increment:', fallbackError.message);
                const simpleCountResult = await client.query(
                  `SELECT COUNT(*)::integer + 1 as next_num
                   FROM payment_receipts
                   WHERE tenant_id = $1 AND receipt_number LIKE $2`,
                  [request.tenantId, `REC${year}%`]
                );
                const nextNum = simpleCountResult.rows[0]?.next_num || 1;
                const sequenceNum = Math.min(nextNum, 999999);
                receiptNumber = `REC${year}${String(sequenceNum).padStart(6, '0')}`;
                console.log('Generated receipt number using simple count:', receiptNumber);
              }
            }
          }

          // Ensure receipt number is defined
          if (!receiptNumber) {
            throw new Error("Failed to generate receipt number");
          }

          console.log('Generated receipt number:', receiptNumber);

          const feeType = String(transaction.fee_type || "").toLowerCase();
          const isScolariteReceipt = feeType === "scolarite";
          let remainingAmount: number | undefined = undefined;

          if (isScolariteReceipt) {
            const feesValue = transaction.fees;
            let feesObj: Record<string, unknown> = {};

            if (feesValue && typeof feesValue === "object") {
              feesObj = feesValue as Record<string, unknown>;
            } else if (typeof feesValue === "string") {
              try {
                feesObj = JSON.parse(feesValue) as Record<string, unknown>;
              } catch {
                feesObj = {};
              }
            }

            const cycleFeesResult = await client.query(
              `SELECT inscription, scolarite, annexes, autres
               FROM cycles_frais
               WHERE tenant_id = $1 AND cycle_id = $2 AND programme_id = $3
               ORDER BY created_at DESC
               LIMIT 1`,
              [request.tenantId, transaction.cycle_id, transaction.programme_id]
            );
            const defaultFees = cycleFeesResult.rows[0] || {};

            const pickFee = (value: any, fallback: any) => {
              const parsedValue = Number(value);
              if (Number.isFinite(parsedValue) && parsedValue > 0) return parsedValue;
              const parsedFallback = Number(fallback);
              return Number.isFinite(parsedFallback) ? parsedFallback : 0;
            };

            const configuredScolarite = pickFee(
              (feesObj as any).scolarite ??
              (feesObj as any)["scolarité"] ??
              (feesObj as any)["scolaritÃ©"] ??
              (feesObj as any).SCOLARITE,
              defaultFees.scolarite
            );

            const paidScolariteResult = await client.query(
              `
                SELECT COALESCE(SUM(amount), 0) as total_paid
                FROM payment_transactions
                WHERE tenant_id = $1
                  AND enrollment_id = $2
                  AND fee_type = 'scolarite'
                  AND status = 'completed'
              `,
              [request.tenantId, transaction.enrollment_id]
            );

            const totalPaidScolarite = Number(paidScolariteResult.rows[0]?.total_paid || 0);
            remainingAmount = Math.max(0, configuredScolarite - totalPaidScolarite);
          }

          // Generate new receipt with the receipt number
          const result = await receiptService.generatePaymentReceipt(
            {
              transactionId: transaction.id,
              studentName: transaction.student_name,
              studentNumber: transaction.student_number,
              feeType: transaction.fee_type,
              amount: parseFloat(transaction.amount),
              currency: transaction.currency,
              paymentMethod: transaction.payment_method,
              paymentDate: new Date(transaction.processed_at || transaction.created_at),
              academicYear: transaction.academic_year_name,
              className: transaction.class_name,
              remainingAmount,
            },
            {
              name: transaction.tenant_name,
              address: transaction.tenant_address,
              phone: transaction.tenant_phone,
              email: transaction.tenant_email,
              logo: transaction.tenant_logo,
            },
            receiptNumber,
            language
          );
          
          // The HTML file is created with a timestamp, we need to copy/rename it to the final location
          const finalDir = join(process.cwd(), 'uploads', 'receipts');
          await fs.mkdir(finalDir, { recursive: true });
          const finalHtmlPath = join(finalDir, `${receiptNumber}.html`);
          
          // Copy the generated HTML file to the final location
          await fs.copyFile(result.filePath, finalHtmlPath);
          console.log('Copied receipt HTML file to:', finalHtmlPath);
          
          // Convert to PDF if requested
          if (format === "pdf") {
            try {
              const pdfPath = await receiptService.convertToPDF(finalHtmlPath);
              // Verify PDF was created
              if (pdfPath && pdfPath.endsWith('.pdf')) {
                // Check if file exists
                try {
                  await fs.access(pdfPath);
                  receiptUrl = `/api/v1/files/receipts/${receiptNumber}.pdf`;
                  console.log('PDF file created successfully at:', pdfPath);
                } catch {
                  console.warn('PDF file not found after conversion, serving HTML');
                  receiptUrl = `/api/v1/files/receipts/${receiptNumber}.html`;
                }
              } else {
                console.warn('PDF conversion returned invalid path, serving HTML file');
                receiptUrl = `/api/v1/files/receipts/${receiptNumber}.html`;
              }
            } catch (error) {
              console.error('PDF conversion failed:', error);
              receiptUrl = `/api/v1/files/receipts/${receiptNumber}.html`;
            }
          } else {
            receiptUrl = `/api/v1/files/receipts/${receiptNumber}.html`;
          }

          console.log('Generated receipt URL:', receiptUrl);

          // Check if receipt already exists for this transaction
          const existingReceiptCheck = await client.query(
            `SELECT id, receipt_number FROM payment_receipts 
             WHERE transaction_id = $1 AND tenant_id = $2`,
            [transactionId, request.tenantId]
          );

          if (existingReceiptCheck.rows.length > 0) {
            // Receipt already exists for this transaction, update it
            const existingReceipt = existingReceiptCheck.rows[0];
            console.log('Updating existing receipt for transaction:', existingReceipt.receipt_number);
            
            await client.query(
              `UPDATE payment_receipts 
               SET receipt_number = $1, receipt_url = $2 
               WHERE transaction_id = $3 AND tenant_id = $4`,
              [receiptNumber, receiptUrl, transactionId, request.tenantId]
            );
          } else {
            // Check if receipt number already exists for another transaction
            const receiptNumberCheck = await client.query(
              `SELECT id, transaction_id FROM payment_receipts 
               WHERE tenant_id = $1 AND receipt_number = $2`,
              [request.tenantId, receiptNumber]
            );

            if (receiptNumberCheck.rows.length > 0) {
              // Receipt number already exists for another transaction
              // Generate a new unique receipt number
              console.warn(`Receipt number ${receiptNumber} already exists, generating new one...`);
              
              const year = new Date().getFullYear();
              let attempts = 0;
              let newReceiptNumber = receiptNumber;
              
              const originalReceiptNumber = receiptNumber; // Save original number for file renaming
              
              while (attempts < 10) {
                // Extract only the last 6 digits (sequence number) from existing receipts
                // Use a subquery with error handling to ignore invalid receipt numbers
                try {
                  const countResult = await client.query(
                    `SELECT COALESCE(MAX(sequence_num), 0) + 1 + $1 as next_num
                     FROM (
                       SELECT 
                         CASE 
                           WHEN LENGTH(receipt_number) = 14 
                           AND receipt_number ~ '^REC\\d{4}\\d{6}$'
                           THEN CAST(RIGHT(receipt_number, 6) AS INTEGER)
                           ELSE NULL
                         END as sequence_num
                       FROM payment_receipts
                       WHERE tenant_id = $2 AND receipt_number LIKE $3
                     ) valid_receipts
                     WHERE sequence_num IS NOT NULL`,
                    [attempts, request.tenantId, `REC${year}%`]
                  );
                  const nextNum = countResult.rows[0]?.next_num || (1 + attempts);
                  // Ensure nextNum doesn't exceed 6 digits
                  const sequenceNum = Math.min(nextNum, 999999);
                  newReceiptNumber = `REC${year}${String(sequenceNum).padStart(6, '0')}`;
                } catch (queryError: any) {
                  // If query fails, use simple count
                  console.warn('Query failed, using simple count:', queryError.message);
                  const simpleCountResult = await client.query(
                    `SELECT COUNT(*)::integer + 1 + $1 as next_num
                     FROM payment_receipts
                     WHERE tenant_id = $2 AND receipt_number LIKE $3`,
                    [attempts, request.tenantId, `REC${year}%`]
                  );
                  const nextNum = simpleCountResult.rows[0]?.next_num || (1 + attempts);
                  const sequenceNum = Math.min(nextNum, 999999);
                  newReceiptNumber = `REC${year}${String(sequenceNum).padStart(6, '0')}`;
                }
                
                // Check if this new number exists
                const checkResult = await client.query(
                  `SELECT id FROM payment_receipts 
                   WHERE tenant_id = $1 AND receipt_number = $2`,
                  [request.tenantId, newReceiptNumber]
                );
                
                if (checkResult.rows.length === 0) {
                  // Found a unique number
                  console.log('Generated new unique receipt number:', newReceiptNumber, '(was:', originalReceiptNumber, ')');
                  
                  // Update file names with new receipt number
                  const oldHtmlPath = join(finalDir, `${originalReceiptNumber}.html`);
                  const newFinalHtmlPath = join(finalDir, `${newReceiptNumber}.html`);
                  const newFinalPdfPath = join(finalDir, `${newReceiptNumber}.pdf`);
                  
                  // Rename files if they exist
                  try {
                    // Check if old file exists before renaming
                    try {
                      await fs.access(oldHtmlPath);
                      await fs.rename(oldHtmlPath, newFinalHtmlPath);
                      console.log('Renamed HTML file from', originalReceiptNumber, 'to', newReceiptNumber);
                    } catch {
                      console.warn('Old HTML file does not exist, skipping rename');
                    }
                    
                    if (format === "pdf") {
                      try {
                        const oldPdfPath = join(finalDir, `${originalReceiptNumber}.pdf`);
                        await fs.access(oldPdfPath);
                        await fs.rename(oldPdfPath, newFinalPdfPath);
                        console.log('Renamed PDF file from', originalReceiptNumber, 'to', newReceiptNumber);
                      } catch {
                        // PDF might not exist yet, regenerate it from HTML
                        try {
                          const htmlPath = newFinalHtmlPath;
                          await fs.access(htmlPath);
                          const pdfPath = await receiptService.convertToPDF(htmlPath);
                          console.log('Regenerated PDF with new receipt number:', pdfPath);
                        } catch (error) {
                          console.warn('Could not regenerate PDF:', error);
                        }
                      }
                    }
                    
                    // Update receipt number and URL
                    receiptNumber = newReceiptNumber;
                    receiptUrl = format === "pdf" 
                      ? `/api/v1/files/receipts/${receiptNumber}.pdf`
                      : `/api/v1/files/receipts/${receiptNumber}.html`;
                  } catch (error) {
                    console.warn('Could not rename files, keeping original receipt number:', error);
                    // Keep original receipt number if rename fails
                    receiptNumber = originalReceiptNumber;
                  }
                  
                  break;
                }
                attempts++;
              }
              
              if (attempts >= 10) {
                throw new Error("Impossible de générer un numéro de reçu unique après plusieurs tentatives");
              }
            }

            // Insert new receipt record
            const insertReceiptQuery = `
              INSERT INTO payment_receipts (
                tenant_id, transaction_id, receipt_number, receipt_url
              ) VALUES ($1, $2, $3, $4)
              RETURNING *
            `;

            await client.query(insertReceiptQuery, [
              request.tenantId,
              transactionId,
              receiptNumber,
              receiptUrl,
            ]);
          }

          // Update transaction with receipt URL
          await client.query(
            "UPDATE payment_transactions SET receipt_url = $1 WHERE id = $2",
            [receiptUrl, transactionId]
          );
        }

        return reply.send({
          data: {
            receiptNumber,
            receiptUrl,
            transactionId,
            format,
            language,
            generatedAt: new Date(),
          },
        });
      } catch (error) {
        console.error("Error generating receipt:", error);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to generate receipt",
        });
      } finally {
        client.release();
      }
    },
  });

  // GET /api/v1/receipts/:receiptNumber - Get receipt by number
  fastify.get("/:receiptNumber", {
    schema: {
      params: {
        type: "object",
        required: ["receiptNumber"],
        properties: {
          receiptNumber: { type: "string" },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const { receiptNumber } = request.params as { receiptNumber: string };
      const client = await pool.connect();

      try {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [request.tenantId]);

        const receiptQuery = `
          SELECT 
            pr.*,
            pt.amount,
            pt.currency,
            pt.fee_type,
            pt.payment_method,
            pt.processed_at,
            sp.student_number,
            u.first_name || ' ' || u.last_name as student_name
          FROM payment_receipts pr
          JOIN payment_transactions pt ON pr.transaction_id = pt.id
          JOIN student_profiles sp ON pt.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          WHERE pr.receipt_number = $1 AND pr.tenant_id = $2
        `;

        const receiptResult = await client.query(receiptQuery, [
          receiptNumber,
          request.tenantId,
        ]);

        if (receiptResult.rows.length === 0) {
          return reply.status(404).send({
            error: "Not Found",
            message: "Receipt not found",
          });
        }

        const receipt = receiptResult.rows[0];

        return reply.send({
          data: {
            receiptNumber: receipt.receipt_number,
            receiptUrl: receipt.receipt_url,
            transactionId: receipt.transaction_id,
            studentName: receipt.student_name,
            studentNumber: receipt.student_number,
            amount: parseFloat(receipt.amount),
            currency: receipt.currency,
            feeType: receipt.fee_type,
            paymentMethod: receipt.payment_method,
            processedAt: receipt.processed_at,
            generatedAt: receipt.generated_at,
          },
        });
      } catch (error) {
        console.error("Error fetching receipt:", error);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to fetch receipt",
        });
      } finally {
        client.release();
      }
    },
  });

  // GET /api/v1/receipts/verify/:receiptNumber - Verify receipt authenticity
  fastify.get("/verify/:receiptNumber", {
    schema: {
      params: {
        type: "object",
        required: ["receiptNumber"],
        properties: {
          receiptNumber: { type: "string" },
        },
      },
    },
    handler: async (request, reply) => {
      const { receiptNumber } = request.params as { receiptNumber: string };
      const client = await pool.connect();

      try {
        // Public endpoint - no tenant restriction for verification
        const verificationQuery = `
          SELECT 
            pr.receipt_number,
            pr.generated_at,
            pt.amount,
            pt.currency,
            pt.status,
            pt.processed_at,
            sp.student_number,
            u.first_name || ' ' || u.last_name as student_name,
            t.name as institution_name
          FROM payment_receipts pr
          JOIN payment_transactions pt ON pr.transaction_id = pt.id
          JOIN student_profiles sp ON pt.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          JOIN tenants t ON pr.tenant_id = t.id
          WHERE pr.receipt_number = $1
        `;

        const verificationResult = await client.query(verificationQuery, [receiptNumber]);

        if (verificationResult.rows.length === 0) {
          return reply.status(404).send({
            error: "Not Found",
            message: "Receipt not found or invalid",
            valid: false,
          });
        }

        const receipt = verificationResult.rows[0];

        return reply.send({
          data: {
            valid: true,
            receiptNumber: receipt.receipt_number,
            studentName: receipt.student_name,
            studentNumber: receipt.student_number,
            institutionName: receipt.institution_name,
            amount: parseFloat(receipt.amount),
            currency: receipt.currency,
            status: receipt.status,
            processedAt: receipt.processed_at,
            generatedAt: receipt.generated_at,
          },
        });
      } catch (error) {
        console.error("Error verifying receipt:", error);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to verify receipt",
          valid: false,
        });
      } finally {
        client.release();
      }
    },
  });

  // GET /api/v1/receipts/student/:studentId - Get all receipts for a student
  fastify.get("/student/:studentId", {
    schema: {
      params: {
        type: "object",
        required: ["studentId"],
        properties: {
          studentId: { type: "string", format: "uuid" },
        },
      },
      querystring: {
        type: "object",
        properties: {
          limit: { type: "number", minimum: 1, maximum: 100, default: 20 },
          offset: { type: "number", minimum: 0, default: 0 },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const { studentId } = request.params as { studentId: string };
      const { limit = 20, offset = 0 } = request.query as any;
      const client = await pool.connect();

      try {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [request.tenantId]);

        // Query to get receipts from payment_receipts table
        // Also include all completed transactions (they can generate receipts on demand)
        const receiptsQuery = `
          SELECT 
            COALESCE(pr.receipt_number, 'REC-' || pt.id::text) as receipt_number,
            COALESCE(pr.receipt_url, pt.receipt_url, '/api/v1/receipts/generate/' || pt.id::text) as receipt_url,
            pt.id as transaction_id,
            pt.amount,
            pt.currency,
            pt.fee_type,
            pt.payment_method,
            pt.processed_at,
            COALESCE(pr.generated_at, pt.processed_at) as generated_at
          FROM payment_transactions pt
          LEFT JOIN payment_receipts pr ON pr.transaction_id = pt.id AND pr.tenant_id = $2
          WHERE pt.student_id = $1 
            AND pt.tenant_id = $2
            AND pt.status = 'completed'
          ORDER BY COALESCE(pr.generated_at, pt.processed_at) DESC
          LIMIT $3 OFFSET $4
        `;

        const receiptsResult = await client.query(receiptsQuery, [
          studentId,
          request.tenantId,
          limit,
          offset,
        ]);

        // Get total count - include all completed transactions
        const countQuery = `
          SELECT COUNT(*) as total
          FROM payment_transactions pt
          WHERE pt.student_id = $1 
            AND pt.tenant_id = $2
            AND pt.status = 'completed'
        `;

        const countResult = await client.query(countQuery, [studentId, request.tenantId]);

        const receipts = receiptsResult.rows.map(row => ({
          receiptNumber: row.receipt_number,
          receiptUrl: row.receipt_url,
          transactionId: row.transaction_id,
          amount: parseFloat(row.amount),
          currency: row.currency,
          feeType: row.fee_type,
          paymentMethod: row.payment_method,
          processedAt: row.processed_at,
          generatedAt: row.generated_at,
        }));

        return reply.send({
          data: receipts,
          pagination: {
            total: parseInt(countResult.rows[0].total),
            limit,
            offset,
            hasMore: offset + limit < parseInt(countResult.rows[0].total),
          },
        });
      } catch (error) {
        console.error("Error fetching student receipts:", error);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to fetch student receipts",
        });
      } finally {
        client.release();
      }
    },
  });
}

